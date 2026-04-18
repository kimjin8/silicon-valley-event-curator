# Claude Code Project Instructions

This is a Node.js pipeline that scrapes Bay Area tech events, curates with Gemini AI, and emails a weekly HTML digest.

## Project Layout

- `index.js` — entry point and orchestration
- `src/config.js` — env vars, model names, scraper settings
- `src/curator.js` — Gemini AI prompt + fallback chain
- `src/scrapers/` — cerebral-valley.js, luma-sf.js, sf-irl.js
- `src/calendar.js` — Google Calendar fetch
- `src/email.js` — Gmail sender
- `user-config.js` — user preferences (interests, schedule, cost)
- `RUNBOOK.md` — operational incident history and fixes

## Diagnosing Failures

When asked to diagnose a failure, follow this procedure:

1. **Check the most recent execution**:
   ```bash
   gcloud run jobs executions list --job=startup-event-curator --region=us-west1 --limit=3
   ```

2. **Read the logs** (look for the error pattern):
   ```bash
   gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="startup-event-curator"' \
     --limit=50 --format="table(timestamp,severity,textPayload)" --project=startup-event-curator
   ```

3. **Match against known issues** in `RUNBOOK.md` — check for:
   - `invalid_grant` → OAuth token expired (INC-003)
   - `fetch failed` / timeout → Gemini API unresponsive (INC-004)
   - `503 Service Unavailable` → Gemini overloaded (INC-004)
   - `finishReason` not `STOP` → truncated output (INC-001)
   - `ENOENT: google-credentials.json` → deployed code missing env var fallback (INC-005)
   - `Cannot find module` → missing files in Docker image
   - `All 3 scrapers failed` → source websites changed

4. **For `invalid_grant`**: this requires human action (browser OAuth flow). Report the issue and provide the re-auth command: `node index.js --auth`.

5. **For Gemini API issues**: the 3-model fallback chain should handle this automatically. If all 3 failed, check https://status.cloud.google.com/ for Gemini outages.

6. **For scraper failures**: check if the source URL still works, then inspect `src/scrapers/` for selector changes needed.

## Testing

```bash
npm test          # run all tests
npm run dry-run   # full pipeline without sending email
```
