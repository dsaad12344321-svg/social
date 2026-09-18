import { google } from "googleapis";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (
  !GOOGLE_CLIENT_ID ||
  !GOOGLE_CLIENT_SECRET ||
  !GOOGLE_REFRESH_TOKEN
) {
  console.warn(
    "Google Drive environment variables are not fully configured."
  );
}

export function getGoogleOAuth2Client() {
  if (
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET ||
    !GOOGLE_REFRESH_TOKEN
  ) {
    throw new Error(
      "Google Drive is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN."
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: GOOGLE_REFRESH_TOKEN,
  });

  return oauth2Client;
}

export function getDriveClient() {
  const auth = getGoogleOAuth2Client();

  return google.drive({
    version: "v3",
    auth,
  });
}

export async function getGoogleAccessToken() {
  const auth = getGoogleOAuth2Client();

  const result = await auth.getAccessToken();

  if (!result.token) {
    throw new Error(
      "Google did not return an access token."
    );
  }

  return result.token;
}

export function getDriveFolderId() {
  return process.env.GOOGLE_DRIVE_FOLDER_ID || undefined;
}

export function getMediaUrl(fileId: string) {
  return `/api/media/${encodeURIComponent(fileId)}`;
}