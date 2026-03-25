// ============================================================
// config.js — All configuration lives here
// ============================================================
//
// This file centralizes every setting the app needs. Environment
// variables are read from a .env file (via the "dotenv" package)
// or from the system environment (e.g., Cloud Run env vars).
//
// To change a setting, either:
//   1. Edit your .env file (for local development)
//   2. Update the Cloud Run Job env vars (for production)
// ============================================================

const path = require("path");

// Load .env file if it exists (ignored in production where env vars
// are set directly in Cloud Run)
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// ── Gemini AI ───────────────────────────────────────────────
// Primary model: Gemini 3 Flash Preview — fast, capable, affordable
// Fallback model: Gemini 3.1 Flash Lite — used when primary hits rate limits
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PRIMARY_MODEL = "gemini-3-flash-preview";
const FALLBACK_MODEL = "gemini-3.1-flash-lite-preview";
const STABLE_FALLBACK_MODEL = "gemini-2.5-flash-lite";

// ── Email ───────────────────────────────────────────────────
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || "hongkimjin@gmail.com";

// ── Google OAuth ────────────────────────────────────────────
// These files store Google API credentials and tokens.
// google-credentials.json: Downloaded from Google Cloud Console
// google-token.json: Created when you run "node index.js --auth"
const GOOGLE_CREDENTIALS_PATH = path.join(__dirname, "..", "google-credentials.json");
const GOOGLE_TOKEN_PATH = path.join(__dirname, "..", "google-token.json");

// Scopes define what the app is allowed to do with Google APIs:
// - calendar.readonly: Read your calendar events (not modify them)
// - gmail.send: Send emails on your behalf
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

// ── Scraper Settings ────────────────────────────────────────
// URLs for the three event sources we scrape
const SCRAPER_URLS = {
  cerebralValley: "https://cerebralvalley.ai/events?locations=BAY_AREA",
  lumaSF: "https://lu.ma/sf",
  sfIrlIndex: "https://sfirl.beehiiv.com/",
};

// How long to wait for a page to load before giving up (in milliseconds)
const SCRAPER_TIMEOUT_MS = 60_000; // 60 seconds

// How many times to retry a failed scrape before giving up
const SCRAPER_MAX_RETRIES = 2;

// How long to wait between retries (in milliseconds)
const SCRAPER_RETRY_DELAY_MS = 5_000; // 5 seconds

// ── Validation ──────────────────────────────────────────────
// Check that required environment variables are set. If any are
// missing, the program fails immediately with a clear error
// message instead of crashing mysteriously later.

function validateConfig() {
  const missing = [];
  if (!GEMINI_API_KEY) missing.push("GEMINI_API_KEY");

  if (missing.length > 0) {
    console.error("\n❌ Missing required environment variables:\n");
    missing.forEach((v) => console.error(`   • ${v}`));
    console.error("\n   See .env.example for details.\n");
    process.exit(1);
  }
}

// ── Export everything ───────────────────────────────────────

module.exports = {
  GEMINI_API_KEY,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  STABLE_FALLBACK_MODEL,
  RECIPIENT_EMAIL,
  GOOGLE_CREDENTIALS_PATH,
  GOOGLE_TOKEN_PATH,
  GOOGLE_SCOPES,
  SCRAPER_URLS,
  SCRAPER_TIMEOUT_MS,
  SCRAPER_MAX_RETRIES,
  SCRAPER_RETRY_DELAY_MS,
  validateConfig,
};
