// ============================================================
// auth.js — Google OAuth2 Authentication
// ============================================================
//
// This module handles logging in to Google so the app can:
//   1. Read your Google Calendar (to check for scheduling conflicts)
//   2. Send emails through Gmail
//
// HOW IT WORKS:
// - Google uses "OAuth2" — a system where you grant an app specific
//   permissions (called "scopes") to access your account.
// - The first time you run "node index.js --auth", it opens a browser
//   where you log in and click "Allow". This creates a "token" — a
//   digital key that the app stores in google-token.json.
// - On future runs, the app uses this saved token. If the token has
//   expired (they expire after 1 hour), it automatically refreshes
//   it using a "refresh token" (a longer-lived key).
//
// FILES INVOLVED:
// - google-credentials.json: Your app's identity (downloaded from
//   Google Cloud Console). Think of it like the app's ID card.
// - google-token.json: Your personal access permission (created when
//   you authorize the app). Think of it like a key card.
// ============================================================

const { google } = require("googleapis");
const fs = require("fs");
const http = require("http");
const url = require("url");
const {
  GOOGLE_CREDENTIALS_PATH,
  GOOGLE_TOKEN_PATH,
  GOOGLE_SCOPES,
} = require("./config");

// The port used for the local OAuth callback server.
// When you authorize the app, Google redirects your browser to
// http://localhost:3099/oauth2callback with a code that we exchange
// for a token.
const OAUTH_CALLBACK_PORT = 3099;

/**
 * Get an authenticated Google API client.
 *
 * This is the main function other modules call. It:
 *   1. Reads your credentials file (app identity)
 *   2. Reads your saved token (your permission)
 *   3. Refreshes the token if it's expired
 *   4. Returns a client object that can make Google API calls
 *
 * @returns {Promise<google.auth.OAuth2>} Authenticated OAuth2 client
 * @throws {Error} If no token file exists (user needs to run --auth)
 */
async function getGoogleAuthClient() {
  // Read the app's credentials (client ID and secret)
  const credentials = JSON.parse(
    fs.readFileSync(GOOGLE_CREDENTIALS_PATH, "utf8")
  );
  const { client_id, client_secret } =
    credentials.installed || credentials.web;

  // Create an OAuth2 client — this is the object that handles
  // authentication with Google
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    `http://localhost:${OAUTH_CALLBACK_PORT}/oauth2callback`
  );

  // Check if we have a saved token
  if (!fs.existsSync(GOOGLE_TOKEN_PATH)) {
    throw new Error(
      "No Google token found. Run: node index.js --auth\n" +
        "This will open a browser where you log in with Google."
    );
  }

  // Load the saved token
  const token = JSON.parse(fs.readFileSync(GOOGLE_TOKEN_PATH, "utf8"));
  oAuth2Client.setCredentials(token);

  // If the token is expired, refresh it automatically.
  // Tokens expire after 1 hour, but the "refresh token" lets us
  // get a new one without re-authorizing.
  if (token.expiry_date && token.expiry_date < Date.now()) {
    console.log("🔄 Google token expired, refreshing...");
    try {
      const { credentials: newToken } =
        await oAuth2Client.refreshAccessToken();
      oAuth2Client.setCredentials(newToken);
      fs.writeFileSync(GOOGLE_TOKEN_PATH, JSON.stringify(newToken, null, 2));
      console.log("✅ Token refreshed successfully");
    } catch (err) {
      throw new Error(
        "Failed to refresh Google token. Please re-authorize:\n" +
          "  node index.js --auth\n" +
          "Error: " +
          err.message
      );
    }
  }

  return oAuth2Client;
}

/**
 * Run the interactive Google OAuth flow.
 *
 * This is called when you run "node index.js --auth". It:
 *   1. Generates a URL where you log in with Google
 *   2. Starts a tiny web server on your computer (port 3099)
 *   3. Waits for Google to redirect back with an authorization code
 *   4. Exchanges the code for a token and saves it to disk
 *
 * You only need to do this once (or again if your token is revoked).
 *
 * @returns {Promise<google.auth.OAuth2>} Authenticated OAuth2 client
 */
async function authenticateGoogle() {
  // Read credentials
  const credentials = JSON.parse(
    fs.readFileSync(GOOGLE_CREDENTIALS_PATH, "utf8")
  );
  const { client_id, client_secret } =
    credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    `http://localhost:${OAUTH_CALLBACK_PORT}/oauth2callback`
  );

  // Generate the authorization URL
  // "access_type: offline" means we get a refresh token (for long-term use)
  // "prompt: consent" means Google always shows the permission screen
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_SCOPES,
    prompt: "consent",
  });

  console.log("\n🔐 Open this URL in your browser to authorize:\n");
  console.log(authUrl);
  console.log("\nWaiting for authorization...\n");

  // Start a temporary web server to catch Google's redirect
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const queryParams = url.parse(req.url, true).query;

      if (queryParams.code) {
        try {
          // Exchange the authorization code for a token
          const { tokens } = await oAuth2Client.getToken(queryParams.code);
          oAuth2Client.setCredentials(tokens);

          // Save the token for future use
          fs.writeFileSync(
            GOOGLE_TOKEN_PATH,
            JSON.stringify(tokens, null, 2)
          );

          res.end("✅ Authorization successful! You can close this window.");
          console.log("✅ Google token saved to", GOOGLE_TOKEN_PATH);

          server.close();
          resolve(oAuth2Client);
        } catch (err) {
          res.end("❌ Authorization failed. Please try again.");
          server.close();
          reject(err);
        }
      }
    });

    server.listen(OAUTH_CALLBACK_PORT);
  });
}

module.exports = { getGoogleAuthClient, authenticateGoogle };
