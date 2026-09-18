
type BufferOrganization = {
  id: string;
  name: string;
  ownerEmail?: string;
};

type BufferRateLimit = {
  windowSeconds: number;
  quota: number;
  remaining: number;
  resetSeconds: number;
};

type BufferRateLimits = {
  fifteenMinutes?: BufferRateLimit;
  oneDay?: BufferRateLimit;
  thirtyDays?: BufferRateLimit;
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

const BUFFER_API_URL = "https://api.buffer.com";

function parseRateLimits(headers: Headers): BufferRateLimits {
  const raw = headers.get("ratelimit") || "";
  const entries = raw.split(/,\s*(?=")/);

  const result: BufferRateLimits = {};

  for (const entry of entries) {
    const windowMatch = entry.match(/"[^"]+"[^;]*;\s*r=(\d+);\s*t=(\d+)/);
    if (!windowMatch) continue;

    const quotaMatch = entry.match(/^"([^"]+)"/);
    const name = quotaMatch?.[1] || "";
    const remaining = Number(windowMatch[1]);
    const resetSeconds = Number(windowMatch[2]);

    let target: keyof BufferRateLimits | null = null;
    if (name.includes("15min")) target = "fifteenMinutes";
    else if (name.includes("1day")) target = "oneDay";
    else if (name.includes("30days")) target = "thirtyDays";
    if (!target) continue;

    const quotaMatchFromName = name.match(/^(\d+)-in-/);
    const quota = quotaMatchFromName ? Number(quotaMatchFromName[1]) : 0;

    result[target] = {
      windowSeconds:
        target === "fifteenMinutes"
          ? 900
          : target === "oneDay"
          ? 86400
          : 2592000,
      quota,
      remaining,
      resetSeconds,
    };
  }

  return {
    ...result,
    accountName: accountData?.name || null,
    accountEmail: accountData?.email || null,
    accountAvatar: accountData?.avatar || null,
    rateLimits,
  };
}

async function bufferRequest(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data: any; rateLimits: BufferRateLimits }> {
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

  console.log(
    "Buffer channels response:",
    JSON.stringify(data, null, 2)
  );

  if (!response.ok) {
    throw new Error(
      data?.errors?.[0]?.message ||
        "Buffer request failed"
    );
  }

  if (
    Array.isArray(data?.errors) &&
    data.errors.length
  ) {
    throw new Error(
      data.errors
        .map(
          (error: { message?: string }) =>
            error.message || "Buffer GraphQL error"
        )
        .join("; ")
    );
  }

  return {
    data: data?.data,
    rateLimits: parseRateLimits(response.headers),
  };
}

async function getBufferAccount(
  apiKey: string,
  accountNumber: number
) {
  const organizationsQuery = 
    `query GetOrganizations {
      account {
        organizations {
          id
          name
          ownerEmail
        }
      }
    }`
  ;

  const organizationsData =
    await bufferRequest(
      apiKey,
      organizationsQuery
    );

  const organizations =
    organizationsData?.account?.organizations || [];

  const result = {
    account: accountNumber,
    organizations: [] as Array<{
      id: string;
      name: string;
      ownerEmail?: string;
      channels: BufferChannel[];
    }>,
  };

  for (
    const organization of organizations as BufferOrganization[]
  ) {
    const channelsQuery = 
      `query GetChannels(
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
          avatar
          isQueuePaused
          isDisconnected
          isLocked
        }
      }`
    

    const channelsResult =
      await bufferRequest(
        apiKey,
        channelsQuery,
        {
          organizationId:
            organization.id,
        }
      );

    rateLimits = channelsResult.rateLimits;

    result.organizations.push({
      id: organization.id,
      name: organization.name,
      ownerEmail:
        organization.ownerEmail,
      channels:
        channelsData?.channels || [],
    });
  }

  return result;
}

export async function GET() {
  try {
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

    const accounts = [];
    const errors: Array<{
      account: number;
      error: string;
    }> = [];

    for (const item of configuredKeys) {
      try {
        const account =
          await getBufferAccount(
            item.key,
            item.account
          );

        accounts.push(account);

        console.log(
          `Buffer account ${item.account} loaded successfully:`,
          JSON.stringify(account, null, 2)
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown Buffer error";

        console.error(
          `Buffer account ${item.account} failed:`,
          message
        );

        errors.push({
          account: item.account,
          error: message,
        });
      }
    }

    const channels =
      accounts.flatMap(
        (account) =>
          account.organizations.flatMap(
            (organization) =>
              organization.channels.map(
                (channel) => ({
                  ...channel,

                  account:
                    account.account,

                  organizationId:
                    organization.id,

                  organizationName:
                    organization.name,

                  ownerEmail:
                    organization.ownerEmail,
                })
              )
          )
      );

    /*
     * Important:
     * If any configured Buffer account failed,
     * do not silently pretend everything is OK.
     *
     * This makes problems with account 2
     * (for example the Instagram account)
     * visible immediately.
     */
    if (errors.length > 0) {
      return Response.json(
        {
          success: false,
          error:
            "فشل تحميل أحد حسابات Buffer",
          accounts,
          channels,
          errors,
        },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      accounts,
      channels,
      errors: [],
    });
  } catch (error) {
    console.error(
      "Buffer channels error:",
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

