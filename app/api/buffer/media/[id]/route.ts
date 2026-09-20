import { Readable } from "node:stream";

import { getDriveClient } from "@/lib/google-drive";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const runtime = "nodejs";

export async function HEAD(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { id } = await context.params;
    const fileId = decodeURIComponent(id);

    console.log("=== BUFFER MEDIA REQUEST DEBUG ===", {
      method: request.method,
      fileId,
      range: request.headers.get("range"),
      userAgent: request.headers.get("user-agent"),
      accept: request.headers.get("accept"),
    });

    if (!fileId) {
      return new Response("Missing file ID.", { status: 400 });
    }

    const metadata = await getMediaMetadata(fileId);

    return new Response(null, {
      status: 200,
      headers: createHeaders(
        metadata.mimeType,
        metadata.name,
        metadata.size
      ),
    });
  } catch (error) {
    console.error("Buffer media HEAD error:", error);

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

    console.log("=== BUFFER MEDIA REQUEST DEBUG ===", {
      method: request.method,
      fileId,
      range: request.headers.get("range"),
      userAgent: request.headers.get("user-agent"),
      accept: request.headers.get("accept"),
    });

    if (!fileId) {
      return new Response("Missing file ID.", { status: 400 });
    }

    const metadata = await getMediaMetadata(fileId);
    const drive = getDriveClient();

    console.log("=== BUFFER MEDIA RESPONSE DEBUG ===", {
      method: request.method,
      fileId,
      status: 200,
      contentType: metadata.mimeType,
      contentLength: metadata.size,
      contentDisposition: metadata.name,
      acceptRanges: "bytes",
    });

    const driveResponse = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      {
        responseType: "stream",
      }
    );

    const webStream = Readable.toWeb(
      driveResponse.data
    ) as ReadableStream;

    const headers = createHeaders(
      metadata.mimeType,
      metadata.name,
      metadata.size
    );

    console.log("BUFFER MEDIA DEBUG", {
      fileId,
      mimeType: metadata.mimeType,
      size: metadata.size,
      driveStatus: getStreamStatus(driveResponse),
    });

    return new Response(webStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Buffer media GET error:", error);

    return new Response(
      error instanceof Error
        ? error.message
        : "Failed to load media.",
      {
        status: getErrorStatus(error),
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      }
    );
  }
}

async function getMediaMetadata(fileId: string) {
  const drive = getDriveClient();

  const response = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size",
    supportsAllDrives: true,
  });

  if (!response.data.id) {
    throw new Error("File not found.");
  }

  return {
    id: response.data.id,
    name: response.data.name,
    mimeType:
      response.data.mimeType ||
      "application/octet-stream",
    size: getFileSize(response.data.size),
  };
}

function createHeaders(
  mimeType: string,
  filename?: string | null,
  size?: number
): Headers {
  const headers = new Headers();

  headers.set("Content-Type", mimeType);
  headers.set(
    "Cache-Control",
    "public, max-age=31536000, immutable"
  );
  headers.set("Accept-Ranges", "bytes");

  if (size !== undefined) {
    headers.set("Content-Length", String(size));
  }

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

function getFileSize(
  size: string | null | undefined
): number | undefined {
  if (!size) return undefined;

  const value = Number(size);

  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    return undefined;
  }

  return value;
}

function getStreamStatus(response: unknown) {
  const value = response as { status?: number };

  return typeof value.status === "number"
    ? value.status
    : 200;
}

function getErrorStatus(error: unknown) {
  const value = error as {
    code?: number;
    response?: { status?: number };
  };

  if (
    typeof value?.response?.status === "number"
  ) {
    return value.response.status;
  }

  if (typeof value?.code === "number") {
    return value.code;
  }

  return 500;
}

function sanitizeFilename(filename: string) {
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
  return encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) =>
      `%${char
        .charCodeAt(0)
        .toString(16)
        .toUpperCase()}`
  );
}
