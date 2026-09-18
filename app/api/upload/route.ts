import {
  getGoogleAccessToken,
  getDriveFolderId,
  getMediaUrl,
} from "@/lib/google-drive";

const MAX_FILE_SIZE = 500 * 1024 * 1024;

const ALLOWED_TYPES = [
  "image/",
  "video/",
];

function isAllowedMimeType(
  mimeType: string
) {
  return ALLOWED_TYPES.some((prefix) =>
    mimeType.startsWith(prefix)
  );
}

function jsonError(
  message: string,
  status = 400
) {
  return Response.json(
    {
      success: false,
      error: message,
    },
    { status }
  );
}

/**
 * POST /api/upload
 *
 * This endpoint has two modes:
 *
 * 1. Browser upload initialization:
 *
 * {
 *   name: "video.mp4",
 *   mimeType: "video/mp4",
 *   size: 123456
 * }
 *
 * Returns a Google Drive resumable upload session URL.
 *
 * 2. Server-side image import:
 *
 * {
 *   media: "https://example.com/image.jpg"
 * }
 *
 * This is used by the existing generator integration.
 */
export async function POST(
  request: Request
): Promise<Response> {
  try {
    const body = await request.json();
    if (
      body?.action === "find" &&
      typeof body?.uploadId === "string" &&
      body.uploadId.trim()
    ) {
      return await findUploadedFile(
        body.uploadId.trim()
      );
    }

    /*
     * --------------------------------------------------
     * MODE 1
     * Import media into Google Drive.
     *
     * Supports:
     *
     * - Base64 data URLs
     * - HTTP/HTTPS URLs
     * --------------------------------------------------
     */
    if (
      typeof body?.media === "string" &&
      body.media.length > 0
    ) {
      if (
        body.media.startsWith("data:image/")
      ) {
        return await importDataUrl(
          body.media
        );
      }

      return await importRemoteMedia(
        body.media
      );
    }

    /*
     * --------------------------------------------------
     * MODE 2
     * Start a browser -> Google Drive resumable upload.
     * --------------------------------------------------
     */

    const name =
      typeof body?.name === "string"
        ? body.name.trim()
        : "";

    const mimeType =
      typeof body?.mimeType === "string"
        ? body.mimeType.trim()
        : "";

    const size =
      typeof body?.size === "number"
        ? body.size
        : 0;

    if (!name) {
      return jsonError(
        "File name is required."
      );
    }

    if (!mimeType) {
      return jsonError(
        "MIME type is required."
      );
    }

    if (!isAllowedMimeType(mimeType)) {
      return jsonError(
        "Only image and video files are allowed."
      );
    }

    if (!Number.isFinite(size) || size <= 0) {
      return jsonError(
        "Invalid file size."
      );
    }

    if (size > MAX_FILE_SIZE) {
      return jsonError(
        "File is larger than the 500 MB limit."
      );
    }

    const accessToken =
      await getGoogleAccessToken();

    const folderId =
      getDriveFolderId();

    const uploadId = crypto.randomUUID();

    const uploadName =
      `${uploadId}-${name}`;

    const metadata: {
      name: string;
      mimeType: string;
      parents?: string[];
    } = {
      name: uploadName,
      mimeType,
    };

    if (folderId) {
      metadata.parents = [folderId];
    }

    /*
     * Google Drive resumable upload initialization.
     *
     * Google returns the upload session URL in
     * the Location response header.
     */
    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type":
            "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length":
            String(size),
        },

        body: JSON.stringify(metadata),
      }
    );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        "Google Drive upload session error:",
        response.status,
        errorText
      );

      return jsonError(
        `Google Drive failed to create the upload session (${response.status}).`,
        500
      );
    }

    const sessionUrl =
      response.headers.get("location");

    if (!sessionUrl) {
      return jsonError(
        "Google Drive did not return an upload session URL.",
        500
      );
    }

    return Response.json({
      success: true,
      sessionUrl,
      uploadId,
      name: uploadName,
      originalName: name,
      mimeType,
      size,
    });
  } catch (error) {
    console.error(
      "Google Drive upload initialization error:",
      error
    );

    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to initialize Google Drive upload.",
      500
    );
  }
}


/**
 * Import a Base64 data URL into Google Drive.
 *
 * Used by the bank poster generators.
 */
async function importDataUrl(
  dataUrl: string
): Promise<Response> {
  try {
    const match =
      dataUrl.match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
      );

    if (!match) {
      return jsonError(
        "Invalid Base64 image data."
      );
    }

    const contentType = match[1];
    const base64Data = match[2];

    if (!isAllowedMimeType(contentType)) {
      return jsonError(
        `Unsupported image type: ${contentType}`
      );
    }

    const buffer =
      Buffer.from(
        base64Data,
        "base64"
      );

    if (!buffer.length) {
      return jsonError(
        "The Base64 image is empty."
      );
    }

    if (
      buffer.length >
      MAX_FILE_SIZE
    ) {
      return jsonError(
        "Image is larger than the 500 MB limit."
      );
    }

    const extension =
      contentType === "image/png"
        ? "png"
        : contentType === "image/webp"
        ? "webp"
        : contentType === "image/gif"
        ? "gif"
        : contentType === "image/jpeg"
        ? "jpg"
        : "jpg";

    const filename =
      `generator-${Date.now()}.${extension}`;

    const accessToken =
      await getGoogleAccessToken();

    const folderId =
      getDriveFolderId();

    const metadata: {
      name: string;
      mimeType: string;
      parents?: string[];
    } = {
      name: filename,
      mimeType: contentType,
    };

    if (folderId) {
      metadata.parents = [folderId];
    }

    /*
     * STEP 1
     * Create Google Drive resumable upload session.
     */
    const sessionResponse =
      await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${accessToken}`,

            "Content-Type":
              "application/json; charset=UTF-8",

            "X-Upload-Content-Type":
              contentType,

            "X-Upload-Content-Length":
              String(buffer.length),
          },

          body:
            JSON.stringify(metadata),
        }
      );

    if (!sessionResponse.ok) {
      const errorText =
        await sessionResponse.text();

      console.error(
        "Google Drive Base64 session error:",
        sessionResponse.status,
        errorText
      );

      return jsonError(
        `Failed to create Google Drive upload session (${sessionResponse.status}).`,
        500
      );
    }

    const sessionUrl =
      sessionResponse.headers.get(
        "location"
      );

    if (!sessionUrl) {
      return jsonError(
        "Google Drive did not return an upload session URL.",
        500
      );
    }

    /*
     * STEP 2
     * Upload the decoded image from our server
     * to Google Drive.
     *
     * No browser -> Google Drive request.
     * Therefore no browser CORS problem.
     */
    const uploadResponse =
      await fetch(sessionUrl, {
        method: "PUT",

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            contentType,

          "Content-Length":
            String(buffer.length),
        },

        body: buffer,
      });

    if (!uploadResponse.ok) {
      const errorText =
        await uploadResponse.text();

      console.error(
        "Google Drive Base64 upload error:",
        uploadResponse.status,
        errorText
      );

      return jsonError(
        `Failed to upload image to Google Drive (${uploadResponse.status}).`,
        500
      );
    }

    const uploadedFile =
      await uploadResponse.json();

    const fileId =
      uploadedFile?.id;

    if (!fileId) {
      return jsonError(
        "Google Drive upload completed but no file ID was returned.",
        500
      );
    }

    return Response.json({
      success: true,
      fileId,
      url: getMediaUrl(fileId),
      mediaType: "image",
      mimeType: contentType,
      name: filename,
    });
  } catch (error) {
    console.error(
      "Base64 media import error:",
      error
    );

    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to import Base64 image into Google Drive.",
      500
    );
  }
}




/**
 * Import a remote image into Google Drive.
 *
 * This preserves the old behavior where the poster
 * generator sends an image URL to /api/upload.
 */
async function importRemoteMedia(
  mediaUrl: string
): Promise<Response> {
  try {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(mediaUrl);
    } catch {
      return jsonError(
        "Invalid media URL."
      );
    }

    if (
      parsedUrl.protocol !== "http:" &&
      parsedUrl.protocol !== "https:"
    ) {
      return jsonError(
        "Only HTTP and HTTPS media URLs are supported."
      );
    }

    const remoteResponse =
      await fetch(parsedUrl.toString());

    if (!remoteResponse.ok) {
      return jsonError(
        `Failed to download source media (${remoteResponse.status}).`,
        502
      );
    }

    if (!remoteResponse.body) {
      return jsonError(
        "Source media has no response body.",
        502
      );
    }

    const contentType =
      remoteResponse.headers.get(
        "content-type"
      ) || "image/jpeg";

    if (!isAllowedMimeType(contentType)) {
      return jsonError(
        `Unsupported source media type: ${contentType}`
      );
    }

    const contentLengthHeader =
      remoteResponse.headers.get(
        "content-length"
      );

    const contentLength =
      contentLengthHeader
        ? Number(contentLengthHeader)
        : undefined;

    if (
      contentLength &&
      contentLength > MAX_FILE_SIZE
    ) {
      return jsonError(
        "Source media is larger than the 500 MB limit."
      );
    }

    const filename =
      getFilenameFromUrl(
        parsedUrl,
        contentType
      );

    const accessToken =
      await getGoogleAccessToken();

    const folderId =
      getDriveFolderId();

    const metadata: {
      name: string;
      mimeType: string;
      parents?: string[];
    } = {
      name: filename,
      mimeType: contentType,
    };

    if (folderId) {
      metadata.parents = [folderId];
    }

    /*
     * Start a resumable upload session.
     */
    const sessionResponse =
      await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
        {
          method: "POST",

          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type":
              "application/json; charset=UTF-8",
            "X-Upload-Content-Type":
              contentType,

            ...(contentLength
              ? {
                  "X-Upload-Content-Length":
                    String(contentLength),
                }
              : {}),
          },

          body: JSON.stringify(metadata),
        }
      );

    if (!sessionResponse.ok) {
      const errorText =
        await sessionResponse.text();

      console.error(
        "Google Drive remote upload session error:",
        errorText
      );

      return jsonError(
        "Failed to create Google Drive upload session.",
        500
      );
    }

    const sessionUrl =
      sessionResponse.headers.get(
        "location"
      );

    if (!sessionUrl) {
      return jsonError(
        "Google Drive did not return an upload session URL.",
        500
      );
    }

    /*
     * Upload the remote response stream directly
     * to Google Drive.
     */
    const uploadHeaders: HeadersInit = {
      "Content-Type": contentType,
    };

    if (contentLength) {
      uploadHeaders[
        "Content-Length"
      ] = String(contentLength);
    }

    const uploadResponse =
      await fetch(sessionUrl, {
        method: "PUT",
        headers: uploadHeaders,
        body: remoteResponse.body,
        // @ts-expect-error
        duplex: "half",
      });

    if (!uploadResponse.ok) {
      const errorText =
        await uploadResponse.text();

      console.error(
        "Google Drive remote media upload error:",
        uploadResponse.status,
        errorText
      );

      return jsonError(
        `Failed to upload media to Google Drive (${uploadResponse.status}).`,
        500
      );
    }

    const uploadedFile =
      await uploadResponse.json();

    const fileId =
      uploadedFile?.id;

    if (!fileId) {
      return jsonError(
        "Google Drive upload completed but no file ID was returned.",
        500
      );
    }

    return Response.json({
      success: true,
      fileId,
      url: getMediaUrl(fileId),
      mediaType:
        contentType.startsWith("video/")
          ? "video"
          : "image",
      mimeType: contentType,
      name: filename,
    });
  } catch (error) {
    console.error(
      "Remote media import error:",
      error
    );

    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to import media into Google Drive.",
      500
    );
  }
}

async function findUploadedFile(
  uploadId: string
): Promise<Response> {
  try {
    const accessToken =
      await getGoogleAccessToken();

    const folderId =
      getDriveFolderId();

    const escapedUploadId =
      uploadId.replace(/'/g, "\\'");

    let query =
      `name contains '${escapedUploadId}-' and trashed = false`;

    if (folderId) {
      query +=
        ` and '${folderId}' in parents`;
    }

    const url =
      new URL(
        "https://www.googleapis.com/drive/v3/files"
      );

    url.searchParams.set(
      "q",
      query
    );

    url.searchParams.set(
      "pageSize",
      "10"
    );

    url.searchParams.set(
      "orderBy",
      "createdTime desc"
    );

    url.searchParams.set(
      "fields",
      "files(id,name,mimeType,size,createdTime)"
    );

    const response =
      await fetch(url.toString(), {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
        },
        cache: "no-store",
      });

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        "Google Drive file lookup error:",
        response.status,
        errorText
      );

      return jsonError(
        "Failed to find uploaded file in Google Drive.",
        500
      );
    }

    const data =
      await response.json();

    const file =
      data?.files?.[0];

    if (!file?.id) {
      return Response.json({
        success: false,
        found: false,
      });
    }

    return Response.json({
      success: true,
      found: true,
      fileId: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      url: getMediaUrl(file.id),
      mediaType:
        file.mimeType?.startsWith("video/")
          ? "video"
          : "image",
    });
  } catch (error) {
    console.error(
      "Google Drive file lookup exception:",
      error
    );

    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to find uploaded file.",
      500
    );
  }
}




function getFilenameFromUrl(
  url: URL,
  mimeType: string
) {
  const lastPart =
    url.pathname
      .split("/")
      .filter(Boolean)
      .pop();

  if (
    lastPart &&
    lastPart.length <= 200
  ) {
    return lastPart;
  }

  const extension =
    mimeType === "image/png"
      ? ".png"
      : mimeType === "image/webp"
      ? ".webp"
      : mimeType === "image/gif"
      ? ".gif"
      : mimeType === "video/webm"
      ? ".webm"
      : mimeType === "video/quicktime"
      ? ".mov"
      : mimeType.startsWith("video/")
      ? ".mp4"
      : ".jpg";

  return `social-${Date.now()}${extension}`;
}