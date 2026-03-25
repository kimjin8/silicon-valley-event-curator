# Weekly Startup Events Curator

An automated pipeline that curates Bay Area tech events and delivers a personalized weekly email digest, powered by Gemini AI.

## Quick Start

### Prerequisites
- Node.js 18+ ([download](https://nodejs.org))
- A Google Cloud project with Calendar & Gmail APIs enabled
- A Gemini API key ([get one](https://aistudio.google.com/apikey))

### 1. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

### 3. Set Up Google Authorization
Place your `google-credentials.json` (from Google Cloud Console) in the project root, then:
```bash
node index.js --auth
```
This opens a browser for Google login. You'll only need to do this once.

### 4. Run
```bash
# Test run (doesn't send email, prints HTML to console)
node index.js --dry-run

# Full run (sends email)
node index.js

# Scheduled mode (runs every Monday at 10am)
TZ=America/Los_Angeles node index.js --cron
```

## Commands

| Command | What It Does |
|---------|-------------|
| `npm start` | Run the full pipeline once |
| `npm run dry-run` | Run without sending email |
| `npm run auth` | Google OAuth setup |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |

## Project Structure
```
├── index.js              # Entry point & orchestration
├── src/
│   ├── config.js          # Configuration & env vars
│   ├── auth.js            # Google OAuth2
│   ├── scrapers/
│   │   ├── cerebral-valley.js
│   │   ├── luma-sf.js
│   │   └── sf-irl.js
│   ├── calendar.js        # Google Calendar integration
│   ├── curator.js         # Gemini AI curation
│   └── email.js           # Gmail sending
├── tests/                 # Automated tests
├── PRD.md                 # Product requirements
├── Dockerfile             # For Cloud Run deployment
└── .env.example           # Environment variable template
```

## How It Works

1. **Scrape** events from Cerebral Valley, Luma SF, and SF IRL (in parallel)
2. **Fetch** your Google Calendar for the upcoming week
3. **Filter** calendar to only busy events
4. **Merge** all data and send to Gemini AI
5. **AI curates** events based on your interests, schedule, and cost preferences
6. **Email** the HTML digest to your inbox

## Google Cloud Deployment

See the [Implementation Plan](implementation_plan.md) for the full 13-step GCP setup guide covering Cloud Run Jobs and Cloud Scheduler.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Gemini API key from aistudio.google.com |
| `RECIPIENT_EMAIL` | No | Email recipient (default: hongkimjin@gmail.com) |
