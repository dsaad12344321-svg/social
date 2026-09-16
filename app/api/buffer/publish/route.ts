
import { NextResponse } from "next/server";

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

type BufferGraphQLResponse<T = any> = {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: unknown;
    path?: unknown;
  }>;
};

type Source = "certificates" | "deposits" | "treasury";

function normalizeService(service: string): string {
  const value = service.trim().toLowerCase();

  if (value === "twitter" || value === "x") {
    return "x";
  }

  return value;
}

/**
 * Creates a YouTube title automatically.
 *
 * The dashboard does not expose a title field.
 * The title is selected automatically from this list.
 */
function getYoutubeTitle(
  source: Source,
  caption: string
): string {
  const bankNames = [
    "بنك مصر",
    "البنك الأهلي المصري",
    "البنك الأهلي",
    "بنك القاهرة",
    "بنك CIB",
    "CIB",
    "بنك QNB",
    "QNB",
    "بنك الإسكندرية",
    "بنك SAIB",
    "بنك فيصل الإسلامي",
    "بنك البركة",
    "بنك التعمير والإسكان",
    "بنك أبو ظبي الإسلامي",
    "مصرف أبو ظبي الإسلامي",
  ];

  const detectedBank = bankNames.find((bank) =>
    caption.includes(bank)
  );

  if (source === "certificates") {
    const titles = detectedBank
      ? [
          `آخر تحديث لشهادات ${detectedBank}`,
          `أحدث شهادات ${detectedBank}`,
          `شهادات ${detectedBank} - آخر تحديث`,
        ]
      : [
          "آخر تحديث لشهادات البنوك المصرية",
          "أحدث شهادات الادخار في البنوك المصرية",
          "شهادات البنوك المصرية - آخر تحديث",
        ];

    return titles[Math.floor(Math.random() * titles.length)];
  }

  if (source === "deposits") {
    const titles = detectedBank
      ? [
          `آخر تحديث لودائع ${detectedBank}`,
          `أحدث ودائع ${detectedBank}`,
          `ودائع ${detectedBank} - آخر تحديث`,
        ]
      : [
          "آخر تحديث لودائع البنوك المصرية",
          "أحدث ودائع البنوك المصرية",
          "ودائع البنوك المصرية - آخر تحديث",
        ];

    return titles[Math.floor(Math.random() * titles.length)];
  }

  const titles = [
    "العروض المقبولة لأذون الخزانة",
    "آخر تحديث لأذون الخزانة المصرية",
    "أحدث أسعار وعروض أذون الخزانة",
  ];

  return titles[Math.floor(Math.random() * titles.length)];
}

async function bufferRequest<T = any>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
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
      `Buffer returned invalid JSON (${response.status}): ${raw.slice(
        0,
        500
      )}`
    );
  }

  console.log("Buffer response:", JSON.stringify(data, null, 2));

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

  const organizationsResponse =
    await bufferRequest<{
      account?: {
        organizations?: Array<{
          id: string;
          name: string;
        }>;
      };
    }>(apiKey, organizationsQuery);

  if (organizationsResponse.errors?.length) {
    throw new Error(
      organizationsResponse.errors
        .map((error) => error.message)
        .join("; ")
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

    const response = await bufferRequest<{
      channels?: Array<{
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
      }>;
    }>(apiKey, channelsQuery, {
      organizationId: organization.id,
    });

    if (response.errors?.length) {
      console.error(
        `Buffer channels error for account ${account}, organization ${organization.id}:`,
        response.errors
      );
      continue;
    }

    const channels = response.data?.channels ?? [];

    for (const channel of channels) {
      allChannels.push({
        ...channel,
        account,
        organizationId: organization.id,
        organizationName: organization.name,
      });
    }
  }

  return allChannels;
}

function isYoutubeChannel(channel: BufferChannel): boolean {
  return normalizeService(channel.service) === "youtube";
}

async function createVideoPost(
  apiKey: string,
  channelId: string,
  caption: string,
  videoUrl: string,
  service: string
) {
  const normalizedService = normalizeService(service);

  const instagramMetadata =
    normalizedService === "instagram"
      ? `
          metadata: {
            instagram: {
              type: reel
              shouldShareToFeed: true
            }
          }
        `
      : "";

  const mutation = `
    mutation CreateVideoPost(
      $channelId: ChannelId!,
      $text: String!,
      $videoUrl: String!
    ) {
      createPost(
        input: {
          channelId: $channelId
          text: $text
          schedulingType: automatic
          mode: shareNow

          assets: [
            {
              video: {
                url: $videoUrl
              }
            }
          ]

          ${instagramMetadata}
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

  return bufferRequest(apiKey, mutation, {
    channelId,
    text: caption,
    videoUrl,
  });
}

function isImagePlatform(channel: BufferChannel): boolean {
  const service = normalizeService(channel.service);

  return [
    "facebook",
    "instagram",
    "tiktok",
    "twitter",
    "x",
    "linkedin",
    "pinterest",
  ].includes(service);
}

async function createImagePost(
  apiKey: string,
  channelId: string,
  caption: string,
  imageUrl: string,
  service: string
) {
  const normalizedService = normalizeService(service);

  const instagramMetadata =
    normalizedService === "instagram"
      ? `
          metadata: {
            instagram: {
              type: post
              shouldShareToFeed: true
            }
          }
        `
      : "";

  const mutation = `
    mutation CreateImagePost(
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

          ${instagramMetadata}
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

  return bufferRequest(apiKey, mutation, {
    channelId,
    text: caption,
    imageUrl,
  });
}

async function createYoutubePost(
  apiKey: string,
  channelId: string,
  caption: string,
  videoUrl: string,
  youtubeTitle: string
) {
  const mutation = `
    mutation CreateYoutubePost(
      $channelId: ChannelId!,
      $text: String!,
      $videoUrl: String!,
      $youtubeTitle: String!,
      $categoryId: String!
    ) {
      createPost(
        input: {
          channelId: $channelId
          text: $text
          schedulingType: automatic
          mode: shareNow

          assets: [
            {
              video: {
                url: $videoUrl
              }
            }
          ]

          metadata: {
            youtube: {
              title: $youtubeTitle
              categoryId: $categoryId
            }
          }
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

  return bufferRequest(apiKey, mutation, {
    channelId,
    text: caption,
    videoUrl,
    youtubeTitle,
    categoryId: "27",
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const imageUrl =
      typeof body?.imageUrl === "string"
        ? body.imageUrl.trim()
        : "";

    const videoUrl =
      typeof body?.videoUrl === "string"
        ? body.videoUrl.trim()
        : "";

    const caption =
      typeof body?.caption === "string"
        ? body.caption.trim()
        : "";

    const source: Source =
      body?.source === "deposits"
        ? "deposits"
        : body?.source === "treasury"
        ? "treasury"
        : "certificates";

    const requestedChannelIds = Array.isArray(body?.channelIds)
      ? body.channelIds.filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.trim().length > 0
        )
      : [];

    // Remove duplicate channel IDs.
    const channelIds = Array.from(
      new Set(requestedChannelIds)
    );

    if (!caption) {
      return NextResponse.json(
        {
          success: false,
          error: "Caption is required",
        },
        { status: 400 }
      );
    }

    if (!channelIds.length) {
      return NextResponse.json(
        {
          success: false,
          error: "At least one channel is required",
        },
        { status: 400 }
      );
    }

    if (!imageUrl && !videoUrl) {
      return NextResponse.json(
        {
          success: false,
          error: "Image or video is required",
        },
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
        {
          success: false,
          error: "No Buffer API keys configured",
        },
        { status: 500 }
      );
    }

    // Load channels from all configured Buffer accounts.
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
      .filter(
        (channel): channel is BufferChannel =>
          Boolean(channel)
      );

    if (!selectedChannels.length) {
      return NextResponse.json(
        {
          success: false,
          error: "No matching Buffer channels were found",
          debug: {
            requestedChannelIds: channelIds,
            availableChannels: allChannels.map((channel) => ({
              id: channel.id,
              name: channel.name,
              displayName: channel.displayName,
              service: channel.service,
              account: channel.account,
              isDisconnected: channel.isDisconnected,
              isLocked: channel.isLocked,
            })),
          },
        },
        { status: 400 }
      );
    }

    const results: Array<{
      channelId: string;
      channelName: string;
      service: string;
      account: number;
      success: boolean;
      postId?: string;
      status?: string;
      error?: string;
      youtubeTitle?: string;
      youtubeCategory?: string;
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
        let response: BufferGraphQLResponse;

        if (isYoutubeChannel(channel)) {
          if (!videoUrl) {
            results.push({
              channelId: channel.id,
              channelName: channel.name,
              service: channel.service,
              account: channel.account,
              success: false,
              error: "YouTube requires a video",
            });

            continue;
          }

          const youtubeTitle = getYoutubeTitle(
            source,
            caption
          );

          response = await createYoutubePost(
            apiKey,
            channel.id,
            caption,
            videoUrl,
            youtubeTitle
          );

          if (response.errors?.length) {
            results.push({
              channelId: channel.id,
              channelName: channel.name,
              service: channel.service,
              account: channel.account,
              success: false,
              error: response.errors
                .map((error) => error.message)
                .join("; "),
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

          results.push({
            channelId: channel.id,
            channelName: channel.name,
            service: channel.service,
            account: channel.account,
            success: true,
            postId: payload?.post?.id,
            status: payload?.post?.status,
            youtubeTitle,
            youtubeCategory: "Education",
          });

          continue;
        }

        // Instagram video = Reel
        // TikTok video = Video
        if (
          normalizeService(channel.service) === "instagram" ||
          normalizeService(channel.service) === "tiktok"
        ) {
          if (!videoUrl) {
            results.push({
              channelId: channel.id,
              channelName: channel.name,
              service: channel.service,
              account: channel.account,
              success: false,
              error: `${channel.service} requires a video`,
            });

            continue;
          }

            response = await createVideoPost(
              apiKey,
              channel.id,
              caption,
              videoUrl,
              channel.service
            );

          if (response.errors?.length) {
            results.push({
              channelId: channel.id,
              channelName: channel.name,
              service: channel.service,
              account: channel.account,
              success: false,
              error: response.errors
                .map((error) => error.message)
                .join("; "),
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

          results.push({
            channelId: channel.id,
            channelName: channel.name,
            service: channel.service,
            account: channel.account,
            success: true,
            postId: payload?.post?.id,
            status: payload?.post?.status,
          });

          continue;
        }

// الجزء الموجود أصلاً بعده
if (!imageUrl) {
  results.push({
    channelId: channel.id,
    channelName: channel.name,
    service: channel.service,
    account: channel.account,
    success: false,
    error: "This platform requires an image",
  });

  continue;
}

        if (!isImagePlatform(channel)) {
          results.push({
            channelId: channel.id,
            channelName: channel.name,
            service: channel.service,
            account: channel.account,
            success: false,
            error: `Unsupported Buffer service: ${channel.service}`,
          });

          continue;
        }

        if (!imageUrl) {
          results.push({
            channelId: channel.id,
            channelName: channel.name,
            service: channel.service,
            account: channel.account,
            success: false,
            error: "This platform requires an image",
          });

          continue;
        }

          response = await createImagePost(
            apiKey,
            channel.id,
            caption,
            imageUrl,
            channel.service
          );

        if (response.errors?.length) {
          results.push({
            channelId: channel.id,
            channelName: channel.name,
            service: channel.service,
            account: channel.account,
            success: false,
            error: response.errors
              .map((error) => error.message)
              .join("; "),
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

        results.push({
          channelId: channel.id,
          channelName: channel.name,
          service: channel.service,
          account: channel.account,
          success: true,
          postId: payload?.post?.id,
          status: payload?.post?.status,
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
              : "Unknown publishing error",
        });
      }
    }

    const published = results.filter(
      (result) => result.success
    );

    const failed = results.filter(
      (result) => !result.success
    );

    return NextResponse.json({
      success:
        published.length > 0 && failed.length === 0,
      partialSuccess:
        published.length > 0 && failed.length > 0,
      published: published.length,
      failed: failed.length,
      total: results.length,
      results,
      debug: {
        requestedChannelIds: channelIds,
        selectedChannels: selectedChannels.map(
          (channel) => ({
            id: channel.id,
            name: channel.name,
            displayName: channel.displayName,
            service: channel.service,
            account: channel.account,
            organizationId: channel.organizationId,
            organizationName:
              channel.organizationName,
          })
        ),
      },
    });
  } catch (error) {
    console.error("Buffer publish error:", error);

    return NextResponse.json(
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

