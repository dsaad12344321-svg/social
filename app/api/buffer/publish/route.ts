
type BufferChannel = {
  id: string;
  name: string;
  displayName?: string | null;
  service: string;
};

type PublishRequest = {
  imageUrl: string;
  caption: string;
  channelIds: string[];
};

type PublishResult = {
  channelId: string;
  success: boolean;
  service?: string;
  channelName?: string;
  postId?: string;
  error?: string;
};

const BUFFER_API_URL = "https://api.buffer.com";

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

  console.log("Buffer response:", JSON.stringify(data));

  if (!response.ok) {
    throw new Error(
      data?.errors?.[0]?.message ||
        `Buffer HTTP error ${response.status}`
    );
  }

  if (
    Array.isArray(data?.errors) &&
    data.errors.length > 0
  ) {
    throw new Error(
      data.errors
        .map(
          (error: { message?: string }) =>
            error?.message || "Buffer GraphQL error"
        )
        .join(" | ")
    );
  }

  return data?.data;
}

async function getChannels(apiKey: string) {
  const organizationsData =
    await bufferRequest(
      apiKey,
      `
        query GetOrganizations {
          account {
            organizations {
              id
              name
              ownerEmail
            }
          }
        }
      `
    );

  const organizations =
    organizationsData?.account?.organizations || [];

  const channels: BufferChannel[] = [];

  for (const organization of organizations) {
    const channelsData =
      await bufferRequest(
        apiKey,
        `
          query GetChannels(
            $organizationId: OrganizationId!
          ) {
            channels(
              input: {
                organizationId: $organizationId
              }
            ) {
              id
              name
              displayName
              service
            }
          }
        `,
        {
          organizationId: organization.id,
        }
      );

    if (
      Array.isArray(
        channelsData?.channels
      )
    ) {
      channels.push(
        ...channelsData.channels
      );
    }
  }

  return channels;
}

async function publishToChannel(
  apiKey: string,
  channelId: string,
  caption: string,
  imageUrl: string
) {
  const mutation = `
    mutation CreatePost(
      $input: CreatePostInput!
    ) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          __typename
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
          __typename
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      channelId,
      text: caption,
      schedulingType: "automatic",
      mode: "shareNow",
      assets: [
        {
          image: {
            url: imageUrl,
          },
        },
      ],
    },
  };

  return bufferRequest(
    apiKey,
    mutation,
    variables
  );
}

export async function POST(
  request: Request
) {
  try {
    const body =
      (await request.json()) as Partial<PublishRequest>;

    const imageUrl =
      typeof body.imageUrl === "string"
        ? body.imageUrl.trim()
        : "";

    const caption =
      typeof body.caption === "string"
        ? body.caption.trim()
        : "";

    const channelIds =
      Array.isArray(body.channelIds)
        ? body.channelIds.filter(
            (id): id is string =>
              typeof id === "string" &&
              id.trim().length > 0
          )
        : [];

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

    if (!caption) {
      return Response.json(
        {
          success: false,
          error: "caption is required",
        },
        { status: 400 }
      );
    }

    if (!channelIds.length) {
      return Response.json(
        {
          success: false,
          error:
            "At least one Buffer channel is required",
        },
        { status: 400 }
      );
    }

    const apiKeys = [
      process.env.BUFFER_API_KEY_1,
      process.env.BUFFER_API_KEY_2,
    ];

    const configuredKeys = apiKeys
      .map((key, index) => ({
        key,
        account: index + 1,
      }))
      .filter(
        (
          item
        ): item is {
          key: string;
          account: number;
        } => Boolean(item.key)
      );

    if (!configuredKeys.length) {
      return Response.json(
        {
          success: false,
          error:
            "No Buffer API keys are configured",
        },
        { status: 500 }
      );
    }

    const results: PublishResult[] = [];

    const foundChannelIds = new Set<string>();

    for (const item of configuredKeys) {
      let channels: BufferChannel[] = [];

      try {
        channels = await getChannels(
          item.key
        );

        console.log(
          `Buffer account ${item.account} channels:`,
          channels.map((channel) => ({
            id: channel.id,
            name:
              channel.displayName ||
              channel.name,
            service: channel.service,
          }))
        );
      } catch (error) {
        console.error(
          `Buffer account ${item.account} channels error:`,
          error
        );

        results.push({
          channelId: `account-${item.account}`,
          success: false,
          error:
            error instanceof Error
              ? `Account ${item.account}: ${error.message}`
              : `Account ${item.account}: Failed to load channels`,
        });

        continue;
      }

      const selectedChannels =
        channels.filter((channel) =>
          channelIds.includes(channel.id)
        );

      for (const channel of selectedChannels) {
        foundChannelIds.add(channel.id);

        try {
          console.log(
            "Publishing to Buffer channel:",
            {
              channelId: channel.id,
              channelName:
                channel.displayName ||
                channel.name,
              service: channel.service,
              imageUrl,
            }
          );

          const data =
            await publishToChannel(
              item.key,
              channel.id,
              caption,
              imageUrl
            );

          const action =
            data?.createPost;

          console.log(
            "Buffer createPost result:",
            JSON.stringify(action)
          );

          if (
            action?.__typename ===
            "PostActionSuccess"
          ) {
            results.push({
              channelId: channel.id,
              success: true,
              service: channel.service,
              channelName:
                channel.displayName ||
                channel.name,
              postId:
                action.post?.id,
            });
          } else {
            results.push({
              channelId: channel.id,
              success: false,
              service: channel.service,
              channelName:
                channel.displayName ||
                channel.name,
              error:
                action?.message ||
                "Buffer did not return a successful post result",
            });
          }
        } catch (error) {
          results.push({
            channelId: channel.id,
            success: false,
            service: channel.service,
            channelName:
              channel.displayName ||
              channel.name,
            error:
              error instanceof Error
                ? error.message
                : "Unknown Buffer error",
          });
        }
      }
    }

    /*
     * Detect channel IDs that were sent by the dashboard
     * but are no longer available through either Buffer API key.
     */
    for (const channelId of channelIds) {
      if (!foundChannelIds.has(channelId)) {
        results.push({
          channelId,
          success: false,
          error:
            "This channel ID was not found in either Buffer account. Refresh Buffer channels and select the account again.",
        });
      }
    }

    const published = results.filter(
      (result) => result.success
    ).length;

    const failed = results.filter(
      (result) => !result.success
    ).length;

    const success =
      published > 0 && failed === 0;

    const partialSuccess =
      published > 0 && failed > 0;

    return Response.json({
      success,
      partialSuccess,
      total: channelIds.length,
      published,
      failed,
      results,
      debug: {
        imageUrl,
        selectedChannelIds: channelIds,
        foundChannelIds:
          Array.from(foundChannelIds),
      },
    });
  } catch (error) {
    console.error(
      "Buffer publish error:",
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

