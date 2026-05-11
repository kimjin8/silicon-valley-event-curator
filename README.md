# Bay Area Tech Event Curator

An automated pipeline that scrapes Bay Area tech events, filters them with Gemini AI against your interests and schedule, and emails you a weekly HTML digest.

**Sources**: Cerebral Valley · Luma SF · SF IRL · your Google Calendar

---

## Quick Start

### Prerequisites

- Node.js 18+ ([download](https://nodejs.org))
- A [Gemini API key](https://aistudio.google.com/apikey) (free tier works)
- A Google Cloud project with **Calendar API** and **Gmail API** enabled

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Configure your preferences

Open [user-config.js](user-config.js) — it's the **only file you need to edit**:

- **Interests** — topics to include or exclude
- **Schedule** — your availability, which region you're in on weekdays vs weekends, and any evenings to block
- **Cost** — price ceiling and exceptions for high-value events

### 3. Set up secrets

```bash
cp .env.example .env
```

Fill in your Gemini API key and recipient email address.

### 4. Authorize Google

Download `google-credentials.json` from your Google Cloud Console (OAuth 2.0 Client ID for a Desktop App), place it in the project root, then run:

```bash
node index.js --auth
```

This opens a browser for Google sign-in. You only need to do this once — the token is saved automatically.

### 5. Run

```bash
# Test run — generates the digest and prints HTML to the console, no email sent
npm run dry-run

# Full run — curates and emails your digest
npm start
```

---

## Customize

Everything is in **[user-config.js](user-config.js)**:

```js
module.exports = {
  region: "San Francisco Bay Area",   // shown in email header

  interests: {
    include: ["AI", "startups", ...], // topics you want
    exclude: ["Healthcare", ...],     // topics to skip
  },

  schedule: {
    availability: "all-day",          // "all-day" or "evening-only"
    weekdayRegion: "South Bay",       // preferred area Mon–Fri
    weekendRegion: "SF",              // area you'll travel to on weekends
    blockedEvenings: [],              // e.g. ["Wednesday"] to block Wed evenings
                                      // (leave empty and let calendar handle it instead)
  },

  cost: {
    maxPriceUSD: 50,                  // price ceiling
    priceExceptions: [...],           // speaker/event types that bypass the limit
  },
};
```

Secrets (API keys, email) go in `.env` — see [.env.example](.env.example).

---

## How It Works

1. **Scrape** — Cerebral Valley and Luma SF are fetched via their APIs; SF IRL is scraped with headless Chromium. All run sequentially, each with its own retry logic.
2. **Calendar** — Your Google Calendar is fetched to find busy events for the week (runs in parallel with scraping).
3. **Pre-filter** — Events that physically conflict with your calendar are dropped before the AI sees them.
4. **Curate** — Gemini AI applies your interest, schedule, and cost rules from `user-config.js` to rank and select events.
5. **Validate** — The AI's output is checked: URL fidelity, Bay Area location sanity, registration link validity, calendar conflicts. Validation failures trigger a corrective retry.
6. **Email** — A styled HTML digest is sent to your inbox via Gmail.

If a scraper fails, the pipeline continues with the remaining sources. It only aborts if all three fail simultaneously.

---

## Commands

| Command | What it does |
|---------|-------------|
| `npm start` | Run the full pipeline once (scrape → curate → email) |
| `npm run dry-run` | Run without sending email (prints HTML to console) |
| `npm run auth` | Google OAuth setup (first time only) |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |

---

## Deploy to Google Cloud (optional)

To run automatically every Monday at 10 AM PT without leaving your computer on:

1. Build and push the Docker image to Google Artifact Registry
2. Create a Cloud Run Job pointing to the image
3. Set environment variables (`GEMINI_API_KEY`, `RECIPIENT_EMAIL`) on the job
4. Create a Cloud Scheduler trigger: `0 10 * * 1` (timezone: `America/Los_Angeles`)

Estimated cost: **$0.00–$0.12/month** (well within free tier).

---

## Self-Healing with Claude Code (optional)

If you use [Claude Code](https://claude.ai/code), you can set up a scheduled agent that checks if the weekly job succeeded and diagnoses failures automatically.

```bash
claude schedule create \
  --name "event-curator-healthcheck" \
  --schedule "15 10 * * 1" \
  --timezone "America/Los_Angeles" \
  --prompt "Check if the startup-event-curator Cloud Run job succeeded in the last 30 minutes. Run: gcloud run jobs executions list --job=startup-event-curator --region=us-west1 --limit=1. If it failed, follow the diagnosis procedure in CLAUDE.md and RUNBOOK.md. Report what went wrong and whether it can be auto-fixed."
```

This is completely optional — the pipeline works fine without it.

---

## Monitoring

The pipeline writes a full run artifact to `runs/<timestamp>.json` after each execution — containing the scraped events, the exact prompt sent to Gemini, the raw HTML returned, and validation stats. Useful for diagnosing unexpected output.

For Cloud Run deployments, set up a Google Cloud Monitoring alert on job failures to get notified when runs break.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | From [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `RECIPIENT_EMAIL` | Yes | Email address to receive the weekly digest |
