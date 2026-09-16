import { handleUpload } from "@vercel/blob/client";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: [
            "image/*",
            "video/*",
          ],
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("=== VERCEL BLOB UPLOAD COMPLETED ===");
        console.log(blob.url);
      },
    });

    return Response.json(jsonResponse);
  } catch (error) {
    console.error("Upload token error:", error);

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to prepare upload",
      },
      { status: 500 }
    );
  }
}