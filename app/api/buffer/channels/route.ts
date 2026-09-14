type BufferOrganization = {
  id: string;
  name: string;
  ownerEmail?: string;
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
    data.errors.length
  ) {
    throw new Error(
      data.errors[0]?.message ||
        "Buffer GraphQL error"
    );
  }

  return data?.data;
}

async function getBufferAccount(
  apiKey: string,
  accountNumber: number
) {
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
    const channelsQuery = `
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
          avatar
          isQueuePaused
          isDisconnected
          isLocked
        }
      }
    `;

    const channelsData =
      await bufferRequest(
        apiKey,
        channelsQuery,
        {
          organizationId:
            organization.id,
        }
      );

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
        accounts.push(
          await getBufferAccount(
            item.key,
            item.account
          )
        );
      } catch (error) {
        errors.push({
          account: item.account,
          error:
            error instanceof Error
              ? error.message
              : "Unknown Buffer error",
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

    return Response.json({
      success: accounts.length > 0,
      accounts,
      channels,
      errors,
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