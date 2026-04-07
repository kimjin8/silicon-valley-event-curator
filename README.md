# Silicon Valley Event Curator

An automated pipeline that scrapes Bay Area tech events, filters them with Gemini AI against your interests and schedule, and emails you a weekly HTML digest every Monday morning.

**Sources**: Cerebral Valley · Luma SF · SF IRL · your Google Calendar

---

## Quick Start

### Prerequisites

- Node.js 18+ ([download](https://nodejs.org))
- A [Gemini API key](https://aistudio.google.com/apikey) (free tier is sufficient)
- A Google Cloud project with **Calendar API** and **Gmail API** enabled

### 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

### 2. Configure your preferences

Open [user-config.js](user-config.js) and edit the three sections:

- **Interests** — topics to include or exclude
- **Schedule** — which days/regions work for you, which evenings to block
- **Cost** — price ceiling and speaker exceptions

### 3. Set up secrets

```bash
cp .env.example .env
```

Open `.env` and fill in your Gemini API key and recipient email address.

### 4. Authorize Google

Download `google-credentials.json` from your Google Cloud Console (OAuth 2.0 Client ID), place it in the project root, then run:

```bash
node index.js --auth
```

This opens a browser for Google login. You only need to do this once — the token is saved automatically.

### 5. Run

```bash
# Test run — prints the HTML digest to the console, no email sent
npm run dry-run

# Full run — curates and emails your digest
npm start
```

---

## Customize

All personalization lives in **[user-config.js](user-config.js)**. It's the only file you need to touch to make this curator your own:

```js
module.exports = {
  region: "San Francisco Bay Area",   // ← your area
  interests: {
    include: ["AI", "startups", ...], // ← topics you want
    exclude: ["Healthcare", ...],     // ← topics to skip
  },
  schedule: {
    weekdayRegion: "South Bay",       // ← where you can go Mon–Fri
    weekendRegion: "SF",              // ← where you can go on weekends
    blockedEvenings: ["Wednesday"],   // ← evenings to skip entirely
  },
  cost: {
    maxPriceUSD: 50,                  // ← price ceiling
    priceExceptions: [...],           // ← speaker types that bypass the limit
  },
};
```

Secrets (API keys, email) go in `.env` — see [.env.example](.env.example).

---

## Commands

| Command | What it does |
|---------|-------------|
| `npm start` | Run the full pipeline once (scrape → curate → email) |
| `npm run dry-run` | Run without sending email (prints HTML to console) |
| `npm run auth` | Google OAuth setup |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |

---

## How It Works

1. **Scrape** — Cerebral Valley, Luma SF, and SF IRL are scraped in parallel using headless Chromium
2. **Calendar** — Your Google Calendar is fetched to find existing busy events for the week
3. **Merge** — All event data and calendar context are combined into a single payload
4. **Curate** — Gemini AI applies your interest, schedule, and cost rules from `user-config.js`
5. **Email** — A styled HTML digest is sent to your inbox via Gmail

If a scraper fails, the pipeline continues with the remaining sources. It only aborts if all three fail.

---

## Deploy to Google Cloud (optional)

To run this automatically every Monday at 10 AM PT without leaving your computer on:

1. Build and push the Docker image to Google Artifact Registry
2. Create a Cloud Run Job pointing to the image
3. Set environment variables (`GEMINI_API_KEY`, `RECIPIENT_EMAIL`) on the job
4. Create a Cloud Scheduler trigger: `0 10 * * 1` (timezone: `America/Los_Angeles`)

Estimated cost: **$0.00–$0.12/month** (well within free tier).

---

## Self-Healing with Claude Code (optional)

If you use [Claude Code](https://claude.ai/code), you can set up an automated agent that checks if the weekly job succeeded and diagnoses failures.

### How it works

1. A Claude Code **scheduled remote agent** runs 15 minutes after your Monday cron job
2. It reads the Cloud Run execution logs via `gcloud`
3. If the job failed, it reads `RUNBOOK.md` to match against known issues and reports the diagnosis
4. The project's `CLAUDE.md` gives the agent full context on how to diagnose this pipeline

### Setup

```bash
# Install Claude Code if you haven't already
# https://claude.ai/code

# Create a scheduled agent that runs every Monday at 10:15 AM PT
claude schedule create \
  --name "event-curator-healthcheck" \
  --schedule "15 10 * * 1" \
  --timezone "America/Los_Angeles" \
  --prompt "Check if the startup-event-curator Cloud Run job succeeded in the last 30 minutes. Run: gcloud run jobs executions list --job=startup-event-curator --region=us-west1 --limit=1. If it failed, follow the diagnosis procedure in CLAUDE.md and RUNBOOK.md. Report what went wrong and whether it can be auto-fixed."
```

To verify it's set up:
```bash
claude schedule list
```

This is **completely optional** — the pipeline works fine without it. It just adds automated diagnosis when things go wrong.

---

## Monitoring & Alerts

The pipeline supports Google Cloud Monitoring alerts. To set up email alerts for job failures:

1. Create a notification channel in [Cloud Monitoring](https://console.cloud.google.com/monitoring/alerting/notifications)
2. Create an alert policy that matches Cloud Run Job errors
3. See `RUNBOOK.md` for the full monitoring setup and incident history

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | From [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `RECIPIENT_EMAIL` | Yes | Email address to receive the weekly digest |
