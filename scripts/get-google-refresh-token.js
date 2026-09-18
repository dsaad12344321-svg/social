const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const http = require("http");
const { URL } = require("url");

// Read .env manually
const envPath = path.join(process.cwd(), ".env");

if (!fs.existsSync(envPath)) {
  console.error("Could not find .env in the project root.");
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, "utf8");

for (const line of envContent.split(/\r?\n/)) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    continue;
  }

  const index = trimmed.indexOf("=");

  if (index === -1) {
    continue;
  }

  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  process.env[key] = value;
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env"
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  "https://vigilant-space-giggle-x57pj7j7wxr7hrx7-3000.app.github.dev/oauth2callback"
);

const scopes = [
  "https://www.googleapis.com/auth/drive",
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: scopes,
});

console.log("\n========================================");
console.log("Open this URL in your browser:");
console.log("========================================\n");
console.log(authUrl);
console.log("\n========================================");
console.log("Waiting for Google OAuth callback...");
console.log("========================================\n");

const server = http.createServer(async (req, res) => {
  try {
        const requestUrl = new URL(
        req.url,
        "https://vigilant-space-giggle-x57pj7j7wxr7hrx7-3000.app.github.dev"
        );

    if (requestUrl.pathname !== "/oauth2callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const code = requestUrl.searchParams.get("code");

    if (!code) {
      res.writeHead(400);
      res.end("Authorization code not found.");
      return;
    }

    console.log("Authorization code received.");
    console.log("Exchanging authorization code for tokens...");

    const { tokens } = await oauth2Client.getToken({
      code,
      redirect_uri:
        "https://vigilant-space-giggle-x57pj7j7wxr7hrx7-3000.app.github.dev/oauth2callback",
    });

    console.log("Token exchange successful.");

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });

    res.end(`
      <html>
        <body style="font-family: Arial; padding: 40px;">
          <h2>Google authorization successful.</h2>
          <p>You can close this browser window and return to the Codespace terminal.</p>
        </body>
      </html>
    `);

    console.log("\n========================================");
    console.log("GOOGLE_REFRESH_TOKEN");
    console.log("========================================\n");

    if (tokens.refresh_token) {
      console.log(tokens.refresh_token);
    } else {
      console.log("NO REFRESH TOKEN RECEIVED");
      console.log(
        "Google may have reused an existing authorization."
      );
    }

    console.log("\n========================================\n");

    server.close();
  } catch (error) {
    console.error("\nOAuth error:");
    console.error(error.response?.data || error.message || error);

    server.close();
    process.exit(1);
  }
});

server.listen(3000, "0.0.0.0", () => {
  console.log("OAuth callback server listening on port 3000.");
});