const BUFFER_API_URL = "https://api.buffer.com";

type BufferChannel = {
  id: string;
  name: string;
  displayName?: string | null;
  descriptor?: string | null;
  externalLink?: string | null;
  service: string;
  avatar?: string | null;
  isQueuePaused?: boolean;
  isDisconnected?: boolean;
  isLocked?: boolean;
  account: number;
  organizationId: string;
  organizationName: string;
  ownerEmail?: string;
};

type BufferAccountError = {
  account: number;
  error: string;
};

async function bufferRequest(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
) {
  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
    cache: "no-store",
  });

  const responseText = await response.text();

  let data: any;

  try {
    data = JSON.parse(responseText);
  } catch {
    data = {
      rawText: responseText,
    };
  }

  console.log(
    "BUFFER RAW RESPONSE:",
    JSON.stringify(data, null, 2)
  );

  return {
    httpStatus: response.status,
    data,
  };
}

async function getChannels(
  apiKey: string,
  account: number
): Promise<{
  channels: BufferChannel[];
  errors: BufferAccountError[];
}> {
  const channels: BufferChannel[] = [];
  const errors: BufferAccountError[] = [];

  const organizationsQuery = `
    query {
      account {
        organizations {
          id
          name
        }
      }
    }
  `;

  const organizationsResult = await bufferRequest(
    apiKey,
    organizationsQuery
  );

  if (
    organizationsResult.data?.errors?.length
  ) {
    errors.push({
      account,
      error:
        organizationsResult.data.errors
          .map(
            (error: any) =>
              error?.message ||
              "Failed to load Buffer organizations"
          )
          .join("; "),
    });

    return {
      channels,
      errors,
    };
  }

  const organizations =
    organizationsResult.data?.data?.account
      ?.organizations || [];

  for (const organization of organizations) {
    const channelsQuery = `
      query GetChannels($organizationId: OrganizationId!) {
        channels(
            input: {
              organizationId: $organizationId
            }
) {
          id
          name
          displayName
          descriptor
          externalLink
          service
          avatar
          isQueuePaused
          isDisconnected
          isLocked
        }
      }
    `;

    const result = await bufferRequest(
      apiKey,
      channelsQuery,
      {
        organizationId: organization.id,
      }
    );

    if (result.data?.errors?.length) {
      errors.push({
        account,
        error:
          result.data.errors
            .map(
              (error: any) =>
                error?.message ||
                "Failed to load Buffer channels"
            )
            .join("; "),
      });

      continue;
    }

    const organizationChannels =
      result.data?.data?.channels || [];

    for (const channel of organizationChannels) {
      channels.push({
        ...channel,
        account,
        organizationId:
          organization.id,
        organizationName:
          organization.name,
      });
    }
  }

  return {
    channels,
    errors,
  };
}

export async function POST(
  request: Request
) {
  try {
    const body = await request.json();

    const imageUrl = body?.imageUrl;
    const caption = body?.caption;
    const channelIds = body?.channelIds;

    if (
      !imageUrl ||
      typeof imageUrl !== "string"
    ) {
      return Response.json(
        {
          success: false,
          error: "imageUrl is required",
        },
        { status: 400 }
      );
    }

    if (
      !imageUrl.startsWith("https://")
    ) {
      return Response.json(
        {
          success: false,
          error:
            "imageUrl must be a public HTTPS URL",
        },
        { status: 400 }
      );
    }

    if (
      !caption ||
      typeof caption !== "string" ||
      !caption.trim()
    ) {
      return Response.json(
        {
          success: false,
          error: "caption is required",
        },
        { status: 400 }
      );
    }

    if (
      !Array.isArray(channelIds) ||
      channelIds.length === 0
    ) {
      return Response.json(
        {
          success: false,
          error:
            "At least one Buffer channel is required",
        },
        { status: 400 }
      );
    }

    const apiKey1 =
      process.env.BUFFER_API_KEY_1;

    const apiKey2 =
      process.env.BUFFER_API_KEY_2;

    if (!apiKey1 && !apiKey2) {
      return Response.json(
        {
          success: false,
          error:
            "No Buffer API keys configured",
        },
        { status: 500 }
      );
    }

    const allChannels: BufferChannel[] =
      [];

    const accountErrors: BufferAccountError[] =
      [];

    if (apiKey1) {
      const result = await getChannels(
        apiKey1,
        1
      );

      allChannels.push(
        ...result.channels
      );

      accountErrors.push(
        ...result.errors
      );
    }

    if (apiKey2) {
      const result = await getChannels(
        apiKey2,
        2
      );

      allChannels.push(
        ...result.channels
      );

      accountErrors.push(
        ...result.errors
      );
    }

    const selectedChannels =
      allChannels.filter((channel) =>
        channelIds.includes(channel.id)
      );

    const missingChannelIds =
      channelIds.filter(
        (id: string) =>
          !selectedChannels.some(
            (channel) =>
              channel.id === id
          )
      );

    if (missingChannelIds.length > 0) {
      return Response.json(
        {
          success: false,
          error:
            "Some Buffer channels were not found",

          missingChannelIds,

          availableChannels:
            allChannels.map((channel) => ({
              id: channel.id,
              name: channel.name,
              displayName:
                channel.displayName,
              descriptor:
                channel.descriptor,
              externalLink:
                channel.externalLink,
              service:
                channel.service,
              account:
                channel.account,
              organizationName:
                channel.organizationName,
              isDisconnected:
                channel.isDisconnected,
              isLocked:
                channel.isLocked,
            })),

          accountErrors,
        },
        { status: 404 }
      );
    }

    const results: any[] = [];

    for (const channel of selectedChannels) {
      if (channel.isDisconnected) {
        results.push({
          channelId: channel.id,
          channelName:
            channel.displayName ||
            channel.name,
          descriptor:
            channel.descriptor,
          externalLink:
            channel.externalLink,
          service:
            channel.service,
          account:
            channel.account,
          organizationName:
            channel.organizationName,
          success: false,
          error:
            "Buffer channel is disconnected",
        });

        continue;
      }

      if (channel.isLocked) {
        results.push({
          channelId: channel.id,
          channelName:
            channel.displayName ||
            channel.name,
          descriptor:
            channel.descriptor,
          externalLink:
            channel.externalLink,
          service:
            channel.service,
          account:
            channel.account,
          organizationName:
            channel.organizationName,
          success: false,
          error:
            "Buffer channel is locked",
        });

        continue;
      }

      const apiKey =
        channel.account === 1
          ? apiKey1
          : apiKey2;

      if (!apiKey) {
        results.push({
          channelId: channel.id,
          channelName:
            channel.displayName ||
            channel.name,
          descriptor:
            channel.descriptor,
          externalLink:
            channel.externalLink,
          service:
            channel.service,
          account:
            channel.account,
          organizationName:
            channel.organizationName,
          success: false,
          error:
            `Missing Buffer API key for account ${channel.account}`,
        });

        continue;
      }

      const mutation = `
        mutation CreatePost(
          $channelId: ChannelId!,
          $text: String!,
          $imageUrl: String!
        ) {
          createPost(
            input: {
              channelId: $channelId
              text: $text
              schedulingType: automatic
              mode: shareNow
              assets: [
                {
                  image: {
                    url: $imageUrl
                  }
                }
              ]
            }
          ) {
            ... on PostActionSuccess {
              post {
                id
                text
                status
                assets {
                  id
                  mimeType
                }
              }
            }

            ... on MutationError {
              message
            }
          }
        }
      `;

      const result = await bufferRequest(
        apiKey,
        mutation,
        {
          channelId: channel.id,
          text: caption.trim(),
          imageUrl,
        }
      );

      const createPost =
        result.data?.data?.createPost;

      /*
       * SUCCESS
       */
      if (createPost?.post?.id) {
        results.push({
          channelId: channel.id,
          channelName:
            channel.displayName ||
            channel.name,
          descriptor:
            channel.descriptor,
          externalLink:
            channel.externalLink,
          service:
            channel.service,
          account:
            channel.account,
          organizationName:
            channel.organizationName,
          success: true,
          postId:
            createPost.post.id,
          status:
            createPost.post.status,
        });

        continue;
      }

      /*
       * REAL BUFFER / GRAPHQL ERROR
       */

      const graphqlErrors =
        Array.isArray(
          result.data?.errors
        )
          ? result.data.errors.map(
              (error: any) => ({
                message:
                  error?.message ||
                  null,
                path:
                  error?.path ||
                  null,
                extensions:
                  error?.extensions ||
                  null,
              })
            )
          : [];

      const mutationError =
        createPost?.message ||
        null;

      const rawApiMessage =
        mutationError ||
        graphqlErrors
          .map(
            (error: any) =>
              error.message
          )
          .filter(Boolean)
          .join("; ") ||
        result.data?.message ||
        result.data?.error ||
        result.data?.rawText ||
        null;

      const errorMessage =
        rawApiMessage ||
        `Buffer API returned HTTP ${result.httpStatus}`;

      console.error(
        "========================================"
      );

      console.error(
        "BUFFER ORIGINAL API ERROR"
      );

      console.error(
        JSON.stringify(
          {
            channelId:
              channel.id,
            channelName:
              channel.displayName ||
              channel.name,
            service:
              channel.service,
            account:
              channel.account,
            organization:
              channel.organizationName,
            httpStatus:
              result.httpStatus,
            mutationError,
            graphqlErrors,
            rawResponse:
              result.data,
          },
          null,
          2
        )
      );

      console.error(
        "========================================"
      );

      results.push({
        channelId: channel.id,

        channelName:
          channel.displayName ||
          channel.name,

        descriptor:
          channel.descriptor,

        externalLink:
          channel.externalLink,

        service:
          channel.service,

        account:
          channel.account,

        organizationName:
          channel.organizationName,

        success: false,

        /*
         * THIS IS THE ORIGINAL ERROR
         * RECEIVED FROM BUFFER
         */
        error: errorMessage,

        /*
         * HTTP STATUS FROM BUFFER
         */
        httpStatus:
          result.httpStatus,

        /*
         * GRAPHQL ERRORS
         */
        graphqlErrors,

        /*
         * MUTATION ERROR
         */
        mutationError,

        /*
         * COMPLETE RAW BUFFER RESPONSE
         */
        bufferResponse:
          result.data,
      });
    }

    const published =
      results.filter(
        (result) =>
          result.success
      ).length;

    const failed =
      results.filter(
        (result) =>
          !result.success
      ).length;

    return Response.json({
      success:
        published > 0 &&
        failed === 0,

      partialSuccess:
        published > 0 &&
        failed > 0,

      published,
      failed,
      total: results.length,

      results,

      debug: {
        imageUrl,

        requestedChannelIds:
          channelIds,

        selectedChannels:
          selectedChannels.map(
            (channel) => ({
              id: channel.id,
              name: channel.name,
              displayName:
                channel.displayName,
              descriptor:
                channel.descriptor,
              externalLink:
                channel.externalLink,
              service:
                channel.service,
              account:
                channel.account,
              organizationName:
                channel.organizationName,
              isDisconnected:
                channel.isDisconnected,
              isLocked:
                channel.isLocked,
            })
          ),

        accountErrors,
      },
    });
  } catch (error) {
    console.error(
      "BUFFER PUBLISH SERVER ERROR:",
      error
    );

    return Response.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Failed to publish through Buffer",

        serverError:
          error instanceof Error
            ? {
                name: error.name,
                message:
                  error.message,
                stack:
                  error.stack,
              }
            : error,
      },
      { status: 500 }
    );
  }
}