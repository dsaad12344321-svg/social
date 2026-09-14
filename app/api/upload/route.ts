
import { put } from "@vercel/blob";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const image = body?.image;

    if (!image || typeof image !== "string") {
      return Response.json(
        {
          success: false,
          error: "Image is required",
        },
        { status: 400 }
      );
    }

    if (!image.startsWith("data:image/")) {
      return Response.json(
        {
          success: false,
          error: "Only data:image URLs are supported",
        },
        { status: 400 }
      );
    }

    const match = image.match(
      /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
    );

    if (!match) {
      return Response.json(
        {
          success: false,
          error: "Invalid image data",
        },
        { status: 400 }
      );
    }

    const contentType = match[1];
    const base64 = match[2];

    const buffer = Buffer.from(base64, "base64");

    if (!buffer.length) {
      return Response.json(
        {
          success: false,
          error: "Image data is empty",
        },
        { status: 400 }
      );
    }

    let extension = "png";

    if (contentType === "image/jpeg") {
      extension = "jpg";
    } else if (contentType === "image/webp") {
      extension = "webp";
    } else if (contentType === "image/gif") {
      extension = "gif";
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
    });
  } catch (error) {
    console.error("Upload error:", error);

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload image",
      },
      { status: 500 }
    );
  }
}

