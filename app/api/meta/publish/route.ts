type Platform = "Facebook" | "Instagram";

const GRAPH_VERSION =
  process.env.META_GRAPH_VERSION || "v24.0";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const platform = body?.platform as Platform;
    const imageUrl = body?.imageUrl;
    const caption = body?.caption || "";

    if (!platform) {
      return Response.json(
        {
          success: false,
          error: "Platform is required",
        },
        { status: 400 }
      );
    }

    if (!imageUrl) {
      return Response.json(
        {
          success: false,
          error: "imageUrl is required",
        },
        { status: 400 }
      );
    }

    if (!imageUrl.startsWith("https://")) {
      return Response.json(
        {
          success: false,
          error:
            "imageUrl must be a public HTTPS URL",
        },
        { status: 400 }
      );
    }

    const accessToken =
      process.env.META_ACCESS_TOKEN;

    if (!accessToken) {
      return Response.json(
        {
          success: false,
          error:
            "META_ACCESS_TOKEN is not configured",
        },
        { status: 500 }
      );
    }

    /*
     * FACEBOOK
     */
    if (platform === "Facebook") {
      const pageId =
        process.env.META_PAGE_ID;

      if (!pageId) {
        return Response.json(
          {
            success: false,
            error:
              "META_PAGE_ID is not configured",
          },
          { status: 500 }
        );
      }

      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: imageUrl,
            caption,
            access_token: accessToken,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return Response.json(
          {
            success: false,
            platform,
            error: data,
          },
          {
            status: response.status,
          }
        );
      }

      return Response.json({
        success: true,
        platform,
        result: data,
      });
    }

    /*
     * INSTAGRAM
     */
    if (platform === "Instagram") {
      const instagramAccountId =
        process.env.META_INSTAGRAM_ACCOUNT_ID;

      if (!instagramAccountId) {
        return Response.json(
          {
            success: false,
            error:
              "META_INSTAGRAM_ACCOUNT_ID is not configured",
          },
          { status: 500 }
        );
      }

      /*
       * STEP 1
       * Create Instagram media container
       */
      const containerResponse = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${instagramAccountId}/media`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image_url: imageUrl,
            caption,
            access_token: accessToken,
          }),
        }
      );

      const containerData =
        await containerResponse.json();

      if (!containerResponse.ok) {
        return Response.json(
          {
            success: false,
            platform,
            step: "create_container",
            error: containerData,
          },
          {
            status: containerResponse.status,
          }
        );
      }

      const creationId =
        containerData?.id;

      if (!creationId) {
        return Response.json(
          {
            success: false,
            platform,
            error:
              "Instagram did not return a creation ID",
          },
          { status: 500 }
        );
      }

      /*
       * STEP 2
       * Publish container
       */
      const publishResponse = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${instagramAccountId}/media_publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            creation_id: creationId,
            access_token: accessToken,
          }),
        }
      );

      const publishData =
        await publishResponse.json();

      if (!publishResponse.ok) {
        return Response.json(
          {
            success: false,
            platform,
            step: "publish",
            error: publishData,
          },
          {
            status: publishResponse.status,
          }
        );
      }

      return Response.json({
        success: true,
        platform,
        result: publishData,
      });
    }

    return Response.json(
      {
        success: false,
        error:
          `Unsupported platform: ${platform}`,
      },
      { status: 400 }
    );
  } catch (error) {
    console.error(
      "Meta publish error:",
      error
    );

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error",
      },
      { status: 500 }
    );
  }
}