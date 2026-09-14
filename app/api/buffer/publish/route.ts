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
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
    cache: "no-store",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.errors?.[0]?.message ||
        "Buffer request failed"
    );
  }

  if (
    Array.isArray(data?.errors) &&
    data.errors.length > 0
  ) {
    throw new Error(
      data.errors[0]?.message ||
        "Buffer GraphQL error"
    );
  }

  return data?.data;
}

async function getChannels(
  apiKey: string
) {
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
          organizationId:
            organization.id,
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

    for (const item of configuredKeys) {
      let channels: BufferChannel[] = [];

      try {
        channels = await getChannels(
          item.key
        );
      } catch (error) {
        console.error(
          `Buffer account ${item.account} channels error:`,
          error
        );

        continue;
      }

      const selectedChannels =
        channels.filter((channel) =>
          channelIds.includes(channel.id)
        );

      for (const channel of selectedChannels) {
        try {
          const data =
            await publishToChannel(
              item.key,
              channel.id,
              caption,
              imageUrl
            );

          const action =
            data?.createPost;

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
                "Buffer failed to create the post",
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

    const published = results.filter(
      (result) => result.success
    ).length;

    const failed = results.filter(
      (result) => !result.success
    ).length;

    return Response.json({
      success:
        published > 0 &&
        failed === 0,
      partialSuccess:
        published > 0 &&
        failed > 0,
      total: channelIds.length,
      published,
      failed,
      results,
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