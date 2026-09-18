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
  const result: BufferRateLimits = {};

  const entries = raw.split(",").map((entry) => entry.trim()).filter(Boolean);

  for (const entry of entries) {
    const nameMatch = entry.match(/"([^"]+)"/);
    const remainingMatch = entry.match(/(?:^|[;\s])r=(\d+)/);
    const resetMatch = entry.match(/(?:^|[;\s])t=(\d+)/);

    if (!nameMatch || !remainingMatch || !resetMatch) {
      continue;
    }

    const name = nameMatch[1];
    const remaining = Number(remainingMatch[1]);
    const resetSeconds = Number(resetMatch[1]);

    let target: keyof BufferRateLimits | null = null;
    let windowSeconds = 0;

    if (name.includes("15min")) {
      target = "fifteenMinutes";
      windowSeconds = 900;
    } else if (name.includes("1day")) {
      target = "oneDay";
      windowSeconds = 86400;
    } else if (name.includes("30days")) {
      target = "thirtyDays";
      windowSeconds = 2592000;
    }

    if (!target) {
      continue;
    }

    const quotaMatch = name.match(/^(\d+)-in-/);
    result[target] = {
      windowSeconds,
      quota: quotaMatch ? Number(quotaMatch[1]) : 0,
      remaining,
      resetSeconds,
    };
  }

  return result;
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

  if (Array.isArray(data?.errors) && data.errors.length) {
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
  const organizationsQuery = `query GetOrganizations {
    account {
      id
      name
      email
      avatar
      organizations {
        id
        name
        ownerEmail
      }
    }
  }`;

  const organizationsResult = await bufferRequest(
    apiKey,
    organizationsQuery
  );

  const accountData = organizationsResult.data?.account;
  const organizations = accountData?.organizations || [];
  let rateLimits = organizationsResult.rateLimits;

  const result = {
    account: accountNumber,
    accountName: accountData?.name || null,
    accountEmail: accountData?.email || null,
    accountAvatar: accountData?.avatar || null,
    rateLimits,
    organizations: [] as Array<{
      id: string;
      name: string;
      ownerEmail?: string;
      channels: BufferChannel[];
    }>,
  };

  for (const organization of organizations as BufferOrganization[]) {
    const channelsQuery = `query GetChannels(
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
    }`;

    const channelsResult = await bufferRequest(
      apiKey,
      channelsQuery,
      {
        organizationId: organization.id,
      }
    );

    if (
      Object.keys(channelsResult.rateLimits).length > 0
    ) {
      rateLimits = channelsResult.rateLimits;
    }

    result.organizations.push({
      id: organization.id,
      name: organization.name,
      ownerEmail: organization.ownerEmail,
      channels: channelsResult.data?.channels || [],
    });
  }

  result.rateLimits = rateLimits;

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
          error: "No Buffer API keys are configured",
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
        const account = await getBufferAccount(
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

    const channels = accounts.flatMap((account) =>
      account.organizations.flatMap((organization) =>
        organization.channels.map((channel) => ({
          ...channel,
          account: account.account,
          organizationId: organization.id,
          organizationName: organization.name,
          ownerEmail: organization.ownerEmail,
        }))
      )
    );

    if (errors.length > 0) {
      return Response.json(
        {
          success: false,
          error: "فشل تحميل أحد حسابات Buffer",
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
    console.error("Buffer channels error:", error);

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
