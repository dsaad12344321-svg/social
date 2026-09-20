import { NextResponse } from "next/server";

const BUFFER_API_URL = "https://api.buffer.com";
const NOTIFICATION_DELAY_MS = 60 * 1000;

type BufferChannel = {
  id: string;
  name: string;
  displayName?: string | null;
  service: string;
  isDisconnected?: boolean;
  isLocked?: boolean;
  hasActiveMemberDevice?: boolean;
  allowedActions?: string[];
  organizationId?: string;
  type?: string;
  descriptor?: string;
  scopes?: string[];
  account: number;
};

type BufferGraphQLResponse<T = any> = {
  data?: T;
  errors?: Array<{
    message: string;
  }>;
};

function normalizeService(service: string): string {
  const value = service.trim().toLowerCase();

  if (value === "twitter" || value === "x") {
    return "x";
  }

  return value;
}

function getYoutubeTitle(caption: string): string {
  const title = caption.replace(/\s+/g, " ").trim();

  return title ? title.slice(0, 100) : "تحديث جديد";
}

const YOUTUBE_CATEGORY_ID = "27";

async function bufferRequest<T = any>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
  operationName?: string
): Promise<BufferGraphQLResponse<T>> {
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
  });

  const raw = await response.text();

  let data: BufferGraphQLResponse<T>;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Buffer returned invalid JSON (${response.status}): ${raw.slice(0, 500)}`
    );
  }

  console.log(
    `=== BUFFER ${operationName || "REQUEST"} ===`,
    JSON.stringify(data, null, 2)
  );

  return data;
}

async function getChannels(
  apiKey: string,
  account: number
): Promise<BufferChannel[]> {
  const organizationsQuery = `
    query GetOrganizations {
      account {
        organizations {
          id
          name
        }
      }
    }
  `;

  const organizationsResponse = await bufferRequest<{
    account?: {
      organizations?: Array<{
        id: string;
        name: string;
      }>;
    };
  }>(apiKey, organizationsQuery, undefined, "GET_ORGANIZATIONS");

  if (organizationsResponse.errors?.length) {
    throw new Error(
      organizationsResponse.errors.map((error) => error.message).join("; ")
    );
  }

  const organizations =
    organizationsResponse.data?.account?.organizations ?? [];

  const allChannels: BufferChannel[] = [];

  for (const organization of organizations) {
    const channelsQuery = `
      query GetChannels($organizationId: OrganizationId!) {
        channels(input: { organizationId: $organizationId }) {
          id
          name
          displayName
          service
          isDisconnected
          isLocked
          hasActiveMemberDevice
          allowedActions
          organizationId
          type
          descriptor
          scopes
        }
      }
    `;

    const response = await bufferRequest<{
      channels?: Array<{
        id: string;
        name: string;
        displayName?: string | null;
        service: string;
        isDisconnected?: boolean;
        isLocked?: boolean;
        hasActiveMemberDevice?: boolean;
        allowedActions?: string[];
        organizationId?: string;
        type?: string;
        descriptor?: string;
        scopes?: string[];
      }>;
    }>(
      apiKey,
      channelsQuery,
      {
        organizationId: organization.id,
      },
      "GET_CHANNELS"
    );

    if (response.errors?.length) {
      console.error(
        `Buffer channels error for account ${account}, organization ${organization.id}:`,
        response.errors
      );
      continue;
    }

    for (const channel of response.data?.channels ?? []) {
      allChannels.push({
        ...channel,
        account,
      });
    }
  }

  return allChannels;
}

function getBufferVideoUrl(request: Request, videoUrl: string): string {
  try {
    const parsedUrl = new URL(videoUrl, request.url);

    if (parsedUrl.pathname.startsWith("/api/media/")) {
      const fileId = parsedUrl.pathname
        .slice("/api/media/".length)
        .split("/")[0];

      if (fileId) {
        return new URL(
          `/api/buffer/media/${encodeURIComponent(fileId)}`,
          request.url
        ).toString();
      }
    }

    return parsedUrl.toString();
  } catch {
    return videoUrl;
  }
}

async function getPostDiagnostics(apiKey: string, postId: string) {
  const query = `
    query GetPostDiagnostics($id: PostId!) {
      post(input: { id: $id }) {
        id
        status
        schedulingType
        shareMode
        notificationStatus
        via
        dueAt
        channelId
        allowedActions
        assets {
          id
          mimeType
          source
          thumbnail
        }
      }
    }
  `;

  const response = await bufferRequest(
    apiKey,
    query,
    { id: postId },
    "GET_NOTIFICATION_POST_DIAGNOSTICS"
  );

  console.log(
    "=== BUFFER NOTIFICATION POST DIAGNOSTICS ===",
    JSON.stringify(response, null, 2)
  );

  return response;
}

async function createNotificationPost(
  apiKey: string,
  channel: BufferChannel,
  caption: string,
  videoUrl: string,
  dueAt: string
) {
  const normalizedService = normalizeService(channel.service);
  const isYoutube = normalizedService === "youtube";

  const youtubeMetadata = isYoutube
    ? `
          metadata: {
            youtube: {
              title: $youtubeTitle
              categoryId: $categoryId
            }
          }
        `
    : "";

  const youtubeVariables = isYoutube
    ? `,
      $youtubeTitle: String!,
      $categoryId: String!`
    : "";

  const mutation = `
    mutation CreateNotificationPost(
      $channelId: ChannelId!,
      $text: String!,
      $videoUrl: String!,
      $dueAt: DateTime!${youtubeVariables}
    ) {
      createPost(
        input: {
          channelId: $channelId
          text: $text
          schedulingType: notification
          mode: customScheduled
          dueAt: $dueAt
          source: "buffer"

          assets: [
            {
              video: {
                url: $videoUrl
              }
            }
          ]

          ${youtubeMetadata}
        }
      ) {
        ... on PostActionSuccess {
          post {
            id
            text
            status
            dueAt
            schedulingType
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

  const variables: Record<string, unknown> = {
    channelId: channel.id,
    text: caption,
    videoUrl,
    dueAt,
  };

  if (isYoutube) {
    variables.youtubeTitle = getYoutubeTitle(caption);
    variables.categoryId = YOUTUBE_CATEGORY_ID;
  }

  return bufferRequest(
    apiKey,
    mutation,
    variables,
    `CREATE_${normalizedService.toUpperCase()}_NOTIFICATION_POST`
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const videoUrl =
      typeof body?.videoUrl === "string" ? body.videoUrl.trim() : "";

    const caption =
      typeof body?.caption === "string" ? body.caption.trim() : "";

    const requestedChannelIds = Array.isArray(body?.channelIds)
      ? body.channelIds.filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.trim().length > 0
        )
      : [];

    const channelIds = Array.from(new Set(requestedChannelIds));

    if (!caption) {
      return NextResponse.json(
        { success: false, error: "Caption is required" },
        { status: 400 }
      );
    }

    if (!videoUrl) {
      return NextResponse.json(
        { success: false, error: "Video is required" },
        { status: 400 }
      );
    }

    if (!channelIds.length) {
      return NextResponse.json(
        { success: false, error: "At least one channel is required" },
        { status: 400 }
      );
    }

    const apiKeys = [
      process.env.BUFFER_API_KEY_1,
      process.env.BUFFER_API_KEY_2,
    ].filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    );

    if (!apiKeys.length) {
      return NextResponse.json(
        { success: false, error: "No Buffer API keys configured" },
        { status: 500 }
      );
    }

    const channelLists = await Promise.all(
      apiKeys.map((apiKey, index) =>
        getChannels(apiKey, index + 1).catch((error) => {
          console.error(
            `Failed to load Buffer channels for account ${index + 1}:`,
            error
          );

          return [] as BufferChannel[];
        })
      )
    );

    const allChannels = channelLists.flat();

    const selectedChannels = channelIds
      .map((channelId) =>
        allChannels.find((channel) => channel.id === channelId)
      )
      .filter((channel): channel is BufferChannel => Boolean(channel));

    if (!selectedChannels.length) {
      return NextResponse.json(
        {
          success: false,
          error: "No matching Buffer channels were found",
        },
        { status: 400 }
      );
    }

    const dueAt = new Date(
      Date.now() + NOTIFICATION_DELAY_MS
    ).toISOString();

    const bufferVideoUrl = getBufferVideoUrl(request, videoUrl);

    const results: Array<{
      channelId: string;
      channelName: string;
      service: string;
      account: number;
      success: boolean;
      postId?: string;
      status?: string;
      dueAt?: string;
      error?: string;
    }> = [];

    for (const channel of selectedChannels) {
      if (channel.isDisconnected) {
        results.push({
          channelId: channel.id,
          channelName: channel.name,
          service: channel.service,
          account: channel.account,
          success: false,
          error: "Channel is disconnected",
        });
        continue;
      }

      if (channel.isLocked) {
        results.push({
          channelId: channel.id,
          channelName: channel.name,
          service: channel.service,
          account: channel.account,
          success: false,
          error: "Channel is locked",
        });
        continue;
      }

      const apiKey = apiKeys[channel.account - 1];

      if (!apiKey) {
        results.push({
          channelId: channel.id,
          channelName: channel.name,
          service: channel.service,
          account: channel.account,
          success: false,
          error: `No API key configured for Buffer account ${channel.account}`,
        });
        continue;
      }

      try {
        console.log(
          "=== BUFFER NOTIFICATION CHANNEL DEVICE DEBUG ===",
          JSON.stringify(
            {
              channelId: channel.id,
              channelName: channel.name,
              service: channel.service,
              account: channel.account,
              hasActiveMemberDevice: channel.hasActiveMemberDevice,
              allowedActions: channel.allowedActions,
              organizationId: channel.organizationId,
              type: channel.type,
              descriptor: channel.descriptor,
              scopes: channel.scopes,
            },
            null,
            2
          )
        );

        const response = await createNotificationPost(
          apiKey,
          channel,
          caption,
          bufferVideoUrl,
          dueAt
        );

        if (response.errors?.length) {
          results.push({
            channelId: channel.id,
            channelName: channel.name,
            service: channel.service,
            account: channel.account,
            success: false,
            error: response.errors.map((error) => error.message).join("; "),
          });
          continue;
        }

        const payload = response.data?.createPost;

        if (payload?.message) {
          results.push({
            channelId: channel.id,
            channelName: channel.name,
            service: channel.service,
            account: channel.account,
            success: false,
            error: payload.message,
          });
          continue;
        }

        const postId = payload?.post?.id;

        if (postId) {
          await getPostDiagnostics(apiKey, postId);
        }

        results.push({
          channelId: channel.id,
          channelName: channel.name,
          service: channel.service,
          account: channel.account,
          success: true,
          postId,
          status: payload?.post?.status,
          dueAt: payload?.post?.dueAt ?? dueAt,
        });
      } catch (error) {
        results.push({
          channelId: channel.id,
          channelName: channel.name,
          service: channel.service,
          account: channel.account,
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown notification scheduling error",
        });
      }
    }

    const scheduled = results.filter((result) => result.success);
    const failed = results.filter((result) => !result.success);

    return NextResponse.json({
      success: scheduled.length > 0 && failed.length === 0,
      partialSuccess: scheduled.length > 0 && failed.length > 0,
      scheduled: scheduled.length,
      failed: failed.length,
      total: results.length,
      dueAt,
      results,
    });
  } catch (error) {
    console.error("Buffer notification scheduling error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to schedule Buffer notification",
      },
      { status: 500 }
    );
  }
}
