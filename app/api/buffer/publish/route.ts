const BUFFER_API_URL = "https://api.buffer.com";

type BufferChannel = {
  id: string;
  name: string;
  displayName?: string | null;
  service: string;
  isQueuePaused?: boolean;
  isDisconnected?: boolean;
  isLocked?: boolean;
  account: number;
  organizationId: string;
  organizationName: string;
  ownerEmail?: string;
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

  const data = await response.json();

  console.log("BUFFER RAW RESPONSE:", JSON.stringify(data, null, 2));

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
  errors: string[];
}> {
  const organizationsQuery = `
    query GetOrganizations {
      account {
        organizations {
          id
          name
          ownerEmail
        }
      }
    }
  `;

  const orgResult = await bufferRequest(
    apiKey,
    organizationsQuery
  );

  const orgs =
    orgResult.data?.data?.account?.organizations || [];

  if (orgResult.data?.errors?.length) {
    return {
      channels: [],
      errors: orgResult.data.errors.map(
        (error: any) =>
          `Account ${account}: ${
            error?.message || "Buffer API error"
          }`
      ),
    };
  }

  const allChannels: BufferChannel[] = [];
  const errors: string[] = [];

  for (const organization of orgs) {
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
      errors.push(
        ...result.data.errors.map(
          (error: any) =>
            `Account ${account} / ${organization.name}: ${
              error?.message || "Buffer API error"
            }`
        )
      );

      continue;
    }

    const channels =
      result.data?.data?.channels || [];

    for (const channel of channels) {
      allChannels.push({
        ...channel,
        account,
        organizationId: organization.id,
        organizationName: organization.name,
        ownerEmail: organization.ownerEmail,
      });
    }
  }

  return {
    channels: allChannels,
    errors,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const imageUrl = body?.imageUrl;
    const caption = body?.caption;
    const channelIds = body?.channelIds;

    console.log("BUFFER PUBLISH REQUEST:", {
      imageUrl,
      captionLength:
        typeof caption === "string"
          ? caption.length
          : 0,
      channelIds,
    });

    if (!imageUrl || typeof imageUrl !== "string") {
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
            "Buffer requires a public HTTPS image URL",
          debug: {
            imageUrl,
          },
        },
        { status: 400 }
      );
    }

    if (!caption || typeof caption !== "string") {
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
          error: "No Buffer channels selected",
        },
        { status: 400 }
      );
    }

    const apiKeys = [
      process.env.BUFFER_API_KEY_1,
      process.env.BUFFER_API_KEY_2,
    ].filter(
      (key): key is string =>
        Boolean(key)
    );

    if (apiKeys.length === 0) {
      return Response.json(
        {
          success: false,
          error:
            "No Buffer API keys configured",
        },
        { status: 500 }
      );
    }

    const allChannels: BufferChannel[] = [];
    const accountErrors: string[] = [];

    for (
      let i = 0;
      i < apiKeys.length;
      i++
    ) {
      const result = await getChannels(
        apiKeys[i],
        i + 1
      );

      allChannels.push(
        ...result.channels
      );

      accountErrors.push(
        ...result.errors
      );
    }

    console.log(
      "BUFFER CHANNELS:",
      JSON.stringify(
        allChannels,
        null,
        2
      )
    );

    console.log(
      "SELECTED CHANNEL IDS:",
      channelIds
    );

    const selectedChannels =
      allChannels.filter((channel) =>
        channelIds.includes(channel.id)
      );

    console.log(
      "SELECTED CHANNELS FOUND:",
      JSON.stringify(
        selectedChannels,
        null,
        2
      )
    );

    const missingChannelIds =
      channelIds.filter(
        (id: string) =>
          !allChannels.some(
            (channel) =>
              channel.id === id
          )
      );

    if (missingChannelIds.length > 0) {
      return Response.json(
        {
          success: false,
          error:
            "Some selected Buffer channels were not found",
          debug: {
            requestedChannelIds:
              channelIds,
            foundChannelIds:
              allChannels.map(
                (channel) =>
                  channel.id
              ),
            missingChannelIds,
            accountErrors,
          },
        },
        { status: 400 }
      );
    }

    const results: any[] = [];

    for (const channel of selectedChannels) {
      const apiKey =
        apiKeys[channel.account - 1];

      if (!apiKey) {
        results.push({
          channelId: channel.id,
          channelName:
            channel.displayName ||
            channel.name,
          account: channel.account,
          success: false,
          error:
            "No API key for this Buffer account",
        });

        continue;
      }

      if (channel.isDisconnected) {
        results.push({
          channelId: channel.id,
          channelName:
            channel.displayName ||
            channel.name,
          service: channel.service,
          account: channel.account,
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
          service: channel.service,
          account: channel.account,
          success: false,
          error:
            "Buffer channel is locked",
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
              }
            }

            ... on MutationError {
              message
            }
          }
        }
      `;

      const result =
        await bufferRequest(
          apiKey,
          mutation,
          {
            channelId: channel.id,
            text: caption,
            imageUrl,
          }
        );

      const createPost =
        result.data?.data?.createPost;

      if (
        createPost?.post
      ) {
        results.push({
          channelId: channel.id,
          channelName:
            channel.displayName ||
            channel.name,
          service: channel.service,
          account: channel.account,
          success: true,
          postId:
            createPost.post.id,
          status:
            createPost.post.status,
        });
      } else {
        const graphqlErrors =
          result.data?.errors
            ?.map(
              (error: any) =>
                error?.message
            )
            .filter(Boolean) || [];

        const mutationError =
          createPost?.message;

        results.push({
          channelId: channel.id,
          channelName:
            channel.displayName ||
            channel.name,
          service: channel.service,
          account: channel.account,
          success: false,
          error:
            mutationError ||
            graphqlErrors.join("; ") ||
            "Unknown Buffer error",
          rawResponse:
            result.data,
        });
      }
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
      success: published > 0 && failed === 0,
      partialSuccess:
        published > 0 && failed > 0,
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
      "BUFFER PUBLISH ERROR:",
      error
    );

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to publish through Buffer",
      },
      { status: 500 }
    );
  }
}