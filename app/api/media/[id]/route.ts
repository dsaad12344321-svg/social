import { Readable } from "node:stream";

import { getDriveClient } from "@/lib/google-drive";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { id } = await context.params;

    const fileId =
      decodeURIComponent(id);

    if (!fileId) {
      return new Response(
        "Missing file ID.",
        { status: 400 }
      );
    }

    const drive =
      getDriveClient();

    /*
     * First retrieve metadata so we know:
     *
     * - MIME type
     * - filename
     * - file size
     */
    const metadataResponse =
      await drive.files.get({
        fileId,
        fields:
          "id,name,mimeType,size",
        supportsAllDrives: true,
      });

    const metadata =
      metadataResponse.data;

    if (!metadata.id) {
      return new Response(
        "File not found.",
        { status: 404 }
      );
    }

    const mimeType =
      metadata.mimeType ||
      "application/octet-stream";

    /*
     * Forward HTTP Range headers.
     *
     * This is important for videos because browsers,
     * Buffer and other consumers may request only a
     * portion of the file.
     */
    const range =
      request.headers.get("range");

    const driveResponse =
      await drive.files.get(
        {
          fileId,
          alt: "media",
          supportsAllDrives: true,
        },
        {
          responseType: "stream",

          ...(range
            ? {
                headers: {
                  Range: range,
                },
              }
            : {}),
        }
      );

    const nodeStream =
      driveResponse.data;

    const webStream =
      Readable.toWeb(
        nodeStream
      ) as ReadableStream;

    const responseHeaders =
      new Headers();

    responseHeaders.set(
      "Content-Type",
      mimeType
    );

    responseHeaders.set(
      "Cache-Control",
      "public, max-age=31536000, immutable"
    );

    responseHeaders.set(
      "Accept-Ranges",
      "bytes"
    );

    if (metadata.name) {
      const filename = sanitizeFilename(
        metadata.name
      );

      const encodedFilename =
        encodeRFC5987ValueChars(
          metadata.name
        );

      responseHeaders.set(
        "Content-Disposition",
        `inline; filename="${filename}"; filename*=UTF-8''${encodedFilename}`
      );
    }

    /*
     * Google may return the HTTP status and headers
     * through the underlying response.
     */
    const status =
      getStreamStatus(
        driveResponse
      );

    const contentLength =
      getHeader(
        driveResponse,
        "content-length"
      );

    const contentRange =
      getHeader(
        driveResponse,
        "content-range"
      );

    if (contentLength) {
      responseHeaders.set(
        "Content-Length",
        contentLength
      );
    }

    if (contentRange) {
      responseHeaders.set(
        "Content-Range",
        contentRange
      );
    }

    return new Response(
      webStream,
      {
        status,
        headers:
          responseHeaders,
      }
    );
  } catch (error: unknown) {
    console.error(
      "Google Drive media error:",
      error
    );

    const status =
      getErrorStatus(error);

    return new Response(
      error instanceof Error
        ? error.message
        : "Failed to load media.",
      {
        status,
        headers: {
          "Content-Type":
            "text/plain; charset=utf-8",
        },
      }
    );
  }
}

function getHeader(
  response: unknown,
  name: string
): string | undefined {
  const data =
    response as {
      headers?: Record<
        string,
        unknown
      >;
    };

  const headers =
    data?.headers;

  if (!headers) {
    return undefined;
  }

  const target =
    name.toLowerCase();

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
  const value =
    response as {
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
  const value =
    error as {
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