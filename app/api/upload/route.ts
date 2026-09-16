import { handleUpload } from "@vercel/blob/client";
import type { HandleUploadBody } from "@vercel/blob/client";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as HandleUploadBody;

    console.log("=== BLOB UPLOAD REQUEST ===");
    console.log(
      JSON.stringify(
        {
          method: request.method,
          type: body?.type,
          body,
        },
        null,
        2
      )
    );

    const jsonResponse = await handleUpload({
      body,
      request,

      onBeforeGenerateToken: async (
        pathname,
        clientPayload,
        multipart
      ) => {
        console.log("=== BLOB GENERATE TOKEN ===");
        console.log(
          JSON.stringify(
            {
              pathname,
              clientPayload,
              multipart,
            },
            null,
            2
          )
        );

        return {
          allowedContentTypes: [
            "image/*",
            "video/*",
          ],

          maximumSizeInBytes: 500 * 1024 * 1024,

          addRandomSuffix: true,
        };
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log("=== VERCEL BLOB UPLOAD COMPLETED ===");

        console.log(
          JSON.stringify(
            {
              url: blob.url,
              pathname: blob.pathname,
              contentType: blob.contentType,
              tokenPayload,
            },
            null,
            2
          )
        );
      },
    });

    console.log("=== BLOB HANDLE UPLOAD RESPONSE ===");
    console.log(JSON.stringify(jsonResponse, null, 2));

    return Response.json(jsonResponse);
  } catch (error) {
    console.error("=== BLOB UPLOAD ERROR ===");
    console.error(error);

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