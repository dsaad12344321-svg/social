type BufferOrganization = {
  id: string;
  name: string;
  ownerEmail?: string | null;
};

type BufferChannel = {
  id: string;
  name: string;
  displayName?: string | null;
  service: string;
  avatar?: string | null;
  isQueuePaused?: boolean;
  isDisconnected?: boolean;
  isLocked?: boolean;
};

type BufferPost = {
  id?: string;
  text?: string | null;
  status?: string | null;
  dueAt?: string | null;
};

type BufferPostResult = {
  account: number;
  organizationId: string;
  organizationName: string;
  channelId: string;
  channelName: string;
  displayName?: string | null;
  service: string;
  success: boolean;
  postId?: string;
  error?: string;
};

const BUFFER_API_URL = "https://api.buffer.com";

async function bufferRequest<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
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

  let data: T & {
    errors?: Array<{ message?: string }>;
  };

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Buffer API returned an invalid JSON response."
    );
  }

  if (!response.ok) {
    const errorMessage =
      data?.errors?.[0]?.message ||
      `Buffer API returned HTTP ${response.status}`;

    throw new Error(errorMessage);
  }

  if (data?.errors && data.errors.length > 0) {
    const message = data.errors
      .map(
        (error) =>
          error?.message || "Unknown Buffer GraphQL error"
      )
      .join("; ");

    throw new Error(message);
  }

  return data;
}

async function getOrganizations(
  apiKey: string
): Promise<BufferOrganization[]> {
  const query = `
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

  const response = await bufferRequest<{
    data?: {
      account?: {
        organizations?: BufferOrganization[];
      };
    };
  }>(apiKey, query);

  return response.data?.account?.organizations ?? [];
}

async function getChannels(
  apiKey: string,
  organizationId: string
): Promise<BufferChannel[]> {
  const query = `
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

  const response = await bufferRequest<{
    data?: {
      channels?: BufferChannel[];
    };
  }>(apiKey, query, {
    organizationId,
  });

  return response.data?.channels ?? [];
}

async function publishToChannel({
  apiKey,
  channelId,
  caption,
  imageUrl,
}: {
  apiKey: string;
  channelId: string;
  caption: string;
  imageUrl: string;
}): Promise<BufferPost> {
  const mutation = `
    mutation CreatePost(
      $channelId: ChannelId!
      $text: String
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
            dueAt
          }
        }

        ... on MutationError {
          message
        }
      }
    }
  `;

  const response = await bufferRequest<{
    data?: {
      createPost?:
        | {
            post?: BufferPost | null;
          }
        | {
            message?: string | null;
          };
    };
  }>(apiKey, mutation, {
    channelId,
    text: caption,
    imageUrl,
  });

  const result = response.data?.createPost;

  if (!result) {
    throw new Error(
      "Buffer did not return a createPost result."
    );
  }

  if ("message" in result && result.message) {
    throw new Error(result.message);
  }

  if (!("post" in result) || !result.post) {
    throw new Error(
      "Buffer did not return a created post."
    );
  }

  return result.post;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const imageUrl =
      typeof body?.imageUrl === "string"
        ? body.imageUrl.trim()
        : "";

    const caption =
      typeof body?.caption === "string"
        ? body.caption
        : "";

    const requestedPlatform =
      typeof body?.platform === "string"
        ? body.platform
        : null;

    if (!imageUrl) {
      return Response.json(
        {
          success: false,
          error: "imageUrl is required.",
        },
        { status: 400 }
      );
    }

    if (!imageUrl.startsWith("https://")) {
      return Response.json(
        {
          success: false,
          error:
            "imageUrl must be a public HTTPS URL.",
        },
        { status: 400 }
      );
    }

    const apiKeys = [
      process.env.BUFFER_API_KEY_1,
      process.env.BUFFER_API_KEY_2,
    ].filter(
      (key): key is string =>
        typeof key === "string" &&
        key.trim().length > 0
    );

    if (apiKeys.length === 0) {
      return Response.json(
        {
          success: false,
          error:
            "No Buffer API keys are configured. Add BUFFER_API_KEY_1 and BUFFER_API_KEY_2.",
        },
        { status: 500 }
      );
    }

    const results: BufferPostResult[] = [];

    for (
      let accountIndex = 0;
      accountIndex < apiKeys.length;
      accountIndex++
    ) {
      const apiKey = apiKeys[accountIndex];
      const accountNumber = accountIndex + 1;

      try {
        const organizations =
          await getOrganizations(apiKey);

        if (organizations.length === 0) {
          results.push({
            account: accountNumber,
            organizationId: "",
            organizationName: "",
            channelId: "",
            channelName: "",
            service: "",
            success: false,
            error:
              "No Buffer organizations were found for this API key.",
          });

          continue;
        }

        for (const organization of organizations) {
          let channels: BufferChannel[];

          try {
            channels = await getChannels(
              apiKey,
              organization.id
            );
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Failed to retrieve Buffer channels.";

            console.error(
              "Buffer channels error:",
              {
                account: accountNumber,
                organizationId:
                  organization.id,
                error,
              }
            );

            results.push({
              account: accountNumber,
              organizationId:
                organization.id,
              organizationName:
                organization.name,
              channelId: "",
              channelName: "",
              service: "",
              success: false,
              error: message,
            });

            continue;
          }

          if (channels.length === 0) {
            results.push({
              account: accountNumber,
              organizationId:
                organization.id,
              organizationName:
                organization.name,
              channelId: "",
              channelName: "",
              service: "",
              success: false,
              error:
                "No Buffer channels were found in this organization.",
            });

            continue;
          }

          for (const channel of channels) {
            const baseResult = {
              account: accountNumber,
              organizationId:
                organization.id,
              organizationName:
                organization.name,
              channelId: channel.id,
              channelName: channel.name,
              displayName:
                channel.displayName,
              service: channel.service,
            };

            if (channel.isDisconnected) {
              results.push({
                ...baseResult,
                success: false,
                error:
                  "This Buffer channel is disconnected.",
              });

              continue;
            }

            if (channel.isLocked) {
              results.push({
                ...baseResult,
                success: false,
                error:
                  "This Buffer channel is locked.",
              });

              continue;
            }

            try {
              const post =
                await publishToChannel({
                  apiKey,
                  channelId:
                    channel.id,
                  caption,
                  imageUrl,
                });

              results.push({
                ...baseResult,
                success: true,
                postId: post.id,
              });
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Failed to publish through Buffer.";

              console.error(
                "Buffer publish failed:",
                {
                  account:
                    accountNumber,
                  organizationId:
                    organization.id,
                  channelId:
                    channel.id,
                  error,
                }
              );

              results.push({
                ...baseResult,
                success: false,
                error: message,
              });
            }
          }
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to connect to Buffer.";

        console.error(
          `Buffer account ${accountNumber} error:`,
          error
        );

        results.push({
          account: accountNumber,
          organizationId: "",
          organizationName: "",
          channelId: "",
          channelName: "",
          service: "",
          success: false,
          error: message,
        });
      }
    }

    const successful = results.filter(
      (result) => result.success
    );

    const failed = results.filter(
      (result) => !result.success
    );

    if (results.length === 0) {
      return Response.json(
        {
          success: false,
          error:
            "No Buffer channels were found.",
          requestedPlatform,
          imageUrl,
        },
        { status: 404 }
      );
    }

    return Response.json({
      success:
        successful.length > 0 &&
        failed.length === 0,

      partialSuccess:
        successful.length > 0 &&
        failed.length > 0,

      total: results.length,

      published:
        successful.length,

      failed:
        failed.length,

      requestedPlatform,

      imageUrl,

      results,
    });
  } catch (error) {
    console.error(
      "Buffer publish route error:",
      error
    );

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error.",
      },
      { status: 500 }
    );
  }
}