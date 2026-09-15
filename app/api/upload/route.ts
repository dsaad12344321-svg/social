
import { put } from "@vercel/blob";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Support the new generic "media" field,
    // while keeping backward compatibility with the old "image" field.
    const media = body?.media ?? body?.image;

    if (!media || typeof media !== "string") {
      return Response.json(
        {
          success: false,
          error: "Media is required",
        },
        { status: 400 }
      );
    }

    // Accept images and videos only.
    if (!media.startsWith("data:image/") && !media.startsWith("data:video/")) {
      return Response.json(
        {
          success: false,
          error: "Only image and video files are supported",
        },
        { status: 400 }
      );
    }

    const match = media.match(
      /^data:(image|video)\/([a-zA-Z0-9.+-]+);base64,(.+)$/
    );

    if (!match) {
      return Response.json(
        {
          success: false,
          error: "Invalid media data",
        },
        { status: 400 }
      );
    }

    const mediaType = match[1];
    const subtype = match[2];
    const base64 = match[3];

    const contentType = `${mediaType}/${subtype}`;
    const buffer = Buffer.from(base64, "base64");

    if (!buffer.length) {
      return Response.json(
        {
          success: false,
          error: "Media data is empty",
        },
        { status: 400 }
      );
    }

    let extension = subtype.toLowerCase();

    // Normalize common extensions.
    if (contentType === "image/jpeg") {
      extension = "jpg";
    } else if (contentType === "image/png") {
      extension = "png";
    } else if (contentType === "image/webp") {
      extension = "webp";
    } else if (contentType === "image/gif") {
      extension = "gif";
    } else if (contentType === "video/mp4") {
      extension = "mp4";
    } else if (contentType === "video/webm") {
      extension = "webm";
    } else if (contentType === "video/quicktime") {
      extension = "mov";
    } else if (contentType === "video/x-msvideo") {
      extension = "avi";
    } else if (contentType === "video/mpeg") {
      extension = "mpeg";
    }

    const filename = `social/${Date.now()}-${crypto.randomUUID()}.${extension}`;

    const blob = await put(filename, buffer, {
      access: "public",
      contentType,
      addRandomSuffix: false,
    });

    return Response.json({
      success: true,
      url: blob.url,
      type: mediaType,
      contentType,
      filename,
    });
  } catch (error) {
    console.error("Upload error:", error);

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload media",
      },
      { status: 500 }
    );
  }
}

