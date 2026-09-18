import { Readable } from "node:stream";

import { getDriveClient } from "@/lib/google-drive";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type ParsedRange =
  | {
      header: string;
      start: number;
      end: number;
    }
  | {
      invalid: true;
    };

export const runtime = "nodejs";

export async function HEAD(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { id } = await context.params;
    const fileId = decodeURIComponent(id);

    if (!fileId) {
      return new Response("Missing file ID.", { status: 400 });
    }

    const drive = getDriveClient();

    const metadataResponse = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size",
      supportsAllDrives: true,
    });

    const metadata = metadataResponse.data;

    if (!metadata.id) {
      return new Response("File not found.", { status: 404 });
    }

    const mimeType =
      metadata.mimeType || "application/octet-stream";
    const totalSize = getFileSize(metadata.size);

    const responseHeaders = createBaseHeaders(
      mimeType,
      metadata.name
    );

    if (totalSize !== undefined) {
      responseHeaders.set(
        "Content-Length",
        String(totalSize)
      );
    }

    const range = request.headers.get("range");

    if (range && totalSize !== undefined) {
      const parsedRange = parseRange(range, totalSize);

      if ("invalid" in parsedRange) {
        console.warn("MEDIA RANGE DEBUG", {
          method: "HEAD",
          fileId,
          requestedRange: range,
          totalSize,
          reason: "invalid-range",
        });

        responseHeaders.set(
          "Content-Range",
          `bytes */${totalSize}`
        );

        return new Response(null, {
          status: 416,
          headers: responseHeaders,
        });
      }

      console.log("MEDIA RANGE DEBUG", {
        method: "HEAD",
        fileId,
        requestedRange: range,
        totalSize,
        normalizedRange: parsedRange.header,
        start: parsedRange.start,
        end: parsedRange.end,
      });

      responseHeaders.set(
        "Content-Range",
        `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`
      );
      responseHeaders.set(
        "Content-Length",
        String(parsedRange.end - parsedRange.start + 1)
      );

      return new Response(null, {
        status: 206,
        headers: responseHeaders,
      });
    }

    return new Response(null, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error: unknown) {
    console.error("Google Drive media HEAD error:", error);

    return new Response(
      error instanceof Error
        ? error.message
        : "Failed to load media metadata.",
      {
        status: getErrorStatus(error),
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      }
    );
  }
}

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { id } = await context.params;
    const fileId = decodeURIComponent(id);

    if (!fileId) {
      return new Response("Missing file ID.", { status: 400 });
    }

    const drive = getDriveClient();

    const metadataResponse = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size",
      supportsAllDrives: true,
    });

    const metadata = metadataResponse.data;

    if (!metadata.id) {
      return new Response("File not found.", { status: 404 });
    }

    const mimeType =
      metadata.mimeType || "application/octet-stream";
    const totalSize = getFileSize(metadata.size);
    const requestedRange = request.headers.get("range");

    let rangeHeader: string | undefined;

    if (requestedRange && totalSize !== undefined) {
      const parsedRange = parseRange(
        requestedRange,
        totalSize
      );

      if ("invalid" in parsedRange) {
        console.warn("MEDIA RANGE DEBUG", {
          method: "GET",
          fileId,
          requestedRange,
          totalSize,
          reason: "invalid-range",
        });

        const responseHeaders = createBaseHeaders(
          mimeType,
          metadata.name
        );

        responseHeaders.set(
          "Content-Range",
          `bytes */${totalSize}`
        );

        return new Response(null, {
          status: 416,
          headers: responseHeaders,
        });
      }

      console.log("MEDIA RANGE DEBUG", {
        method: "GET",
        fileId,
        requestedRange,
        totalSize,
        normalizedRange: parsedRange.header,
        start: parsedRange.start,
        end: parsedRange.end,
      });

      rangeHeader = parsedRange.header;
    } else if (requestedRange) {
      console.log("MEDIA RANGE DEBUG", {
        method: "GET",
        fileId,
        requestedRange,
        totalSize,
        normalizedRange: "unmodified-no-size",
      });

      rangeHeader = requestedRange;
    }

    const driveResponse = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      {
        responseType: "stream",

        ...(rangeHeader
          ? {
              headers: {
                Range: rangeHeader,
              },
            }
          : {}),
      }
    );

    const nodeStream = driveResponse.data;
    const webStream = Readable.toWeb(
      nodeStream
    ) as ReadableStream;

    const responseHeaders = createBaseHeaders(
      mimeType,
      metadata.name
    );

    const status = getStreamStatus(driveResponse);

    const contentLength = getHeader(
      driveResponse,
      "content-length"
    );

    const contentRange = getHeader(
      driveResponse,
      "content-range"
    );

    console.log("MEDIA RANGE DEBUG DRIVE", {
      method: "GET",
      fileId,
      requestedRange,
      rangeHeader,
      totalSize,
      driveStatus: status,
      driveContentLength: contentLength,
      driveContentRange: contentRange,
    });

    if (contentLength) {
      responseHeaders.set(
        "Content-Length",
        contentLength
      );
    } else if (
      totalSize !== undefined &&
      status === 200
    ) {
      responseHeaders.set(
        "Content-Length",
        String(totalSize)
      );
    }

    if (contentRange) {
      responseHeaders.set(
        "Content-Range",
        contentRange
      );
    }

    return new Response(webStream, {
      status,
      headers: responseHeaders,
    });
  } catch (error: unknown) {
    console.error(
      "Google Drive media error:",
      error
    );

    return new Response(
      error instanceof Error
        ? error.message
        : "Failed to load media.",
      {
        status: getErrorStatus(error),
        headers: {
          "Content-Type":
            "text/plain; charset=utf-8",
        },
      }
    );
  }
}

function parseRange(
  range: string,
  totalSize: number
): ParsedRange {
  const trimmed = range.trim();

  if (!/^bytes=/i.test(trimmed)) {
    return { invalid: true };
  }

  const value = trimmed.slice(6);

  // Buffer/video clients can occasionally send multiple ranges.
  // Google Drive media requests are handled one range at a time, so
  // use the first range instead of rejecting the whole request.
  const firstRange = value.split(",")[0]?.trim();

  if (!firstRange) {
    return { invalid: true };
  }

  const match = /^(\d*)-(\d*)$/.exec(firstRange);

  if (!match) {
    return { invalid: true };
  }

  const startText = match[1];
  const endText = match[2];

  // Suffix range: bytes=-500
  if (!startText) {
    if (!endText) {
      return { invalid: true };
    }

    const suffixLength = Number(endText);

    if (
      !Number.isSafeInteger(suffixLength) ||
      suffixLength <= 0
    ) {
      return { invalid: true };
    }

    const start = Math.max(
      totalSize - suffixLength,
      0
    );
    const end = totalSize - 1;

    return {
      header: `bytes=${start}-${end}`,
      start,
      end,
    };
  }

  const start = Number(startText);

  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start >= totalSize
  ) {
    return { invalid: true };
  }

  let end = endText
    ? Number(endText)
    : totalSize - 1;

  if (
    !Number.isSafeInteger(end) ||
    end < start
  ) {
    return { invalid: true };
  }

  end = Math.min(
    end,
    totalSize - 1
  );

  return {
    header: `bytes=${start}-${end}`,
    start,
    end,
  };
}

function getFileSize(
  size: string | null | undefined
): number | undefined {
  if (!size) {
    return undefined;
  }

  const value = Number(size);

  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    return undefined;
  }

  return value;
}

function createBaseHeaders(
  mimeType: string,
  filename?: string | null
): Headers {
  const headers = new Headers();

  headers.set(
    "Content-Type",
    mimeType
  );

  headers.set(
    "Cache-Control",
    "public, max-age=31536000, immutable"
  );

  headers.set(
    "Accept-Ranges",
    "bytes"
  );

  if (filename) {
    const safeFilename =
      sanitizeFilename(filename);

    const encodedFilename =
      encodeRFC5987ValueChars(filename);

    headers.set(
      "Content-Disposition",
      `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
    );
  }

  return headers;
}

function getHeader(
  response: unknown,
  name: string
): string | undefined {
  const data = response as {
    headers?: Record<
      string,
      unknown
    >;
  };

  const headers = data?.headers;

  if (!headers) {
    return undefined;
  }

  const target = name.toLowerCase();

  for (const [
    key,
    value,
  ] of Object.entries(headers)) {
    if (
      key.toLowerCase() ===
      target
    ) {
      if (
        typeof value === "string"
      ) {
        return value;
      }

      if (
        typeof value === "number"
      ) {
        return String(value);
      }
    }
  }

  return undefined;
}

function getStreamStatus(
  response: unknown
) {
  const value = response as {
    status?: number;
  };

  if (
    typeof value.status ===
    "number"
  ) {
    return value.status;
  }

  return 200;
}

function getErrorStatus(
  error: unknown
) {
  const value = error as {
    code?: number;
    response?: {
      status?: number;
    };
  };

  if (
    typeof value?.response?.status ===
    "number"
  ) {
    return value.response.status;
  }

  if (
    typeof value?.code === "number"
  ) {
    return value.code;
  }

  return 500;
}

function sanitizeFilename(
  filename: string
) {
  return filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\r\n"]/g, "")
    .replace(/\\/g, "_")
    .slice(0, 180) || "media";
}

function encodeRFC5987ValueChars(
  filename: string
) {
  return encodeURIComponent(
    filename
  ).replace(
    /['()*]/g,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}