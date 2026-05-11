# Claude Code Project Instructions

This is a Node.js pipeline that scrapes Bay Area tech events, curates with Gemini AI, and emails a weekly HTML digest.

## Project Layout

- `index.js` — entry point, orchestration, PT-formatted date range computation
- `src/config.js` — env vars, Gemini model names, scraper settings
- `src/curator.js` — Gemini AI prompt + 2-model fallback chain (primary → lite); each model gets one corrective-feedback retry naming validation failures before falling back
- `src/prefilter.js` — drops events with hard calendar conflicts before AI sees data (physics, not preference)
- `src/validator.js` — sanity checks on Gemini's HTML output: URL fidelity, Bay Area location allowlist, register-link validity, calendar conflicts, coverage floor
- `src/scrapers/` — cerebral-valley.js, luma-sf.js, sf-irl.js, utils.js (shared retry/browser logic, `toPacificTime`, `formatTimeRange`)
- `src/calendar.js` — Google Calendar fetch + busy-event filter
- `src/email.js` — Gmail sender
- `user-config.js` — user preferences (interests, schedule, cost) — the one file users edit
- `runs/` — per-run diagnostic artifacts (gitignored): scraped events, prompt, raw HTML, validation stats
- `RUNBOOK.md` — operational incident history and fixes (gitignored)

## Architecture Notes

**Date/time handling**: all user-facing date labels are pre-formatted in Pacific Time by the pipeline before the AI sees them (`todayPT`, `weekLabelPT`, `dayOfWeek`, `datePT`, `displayTime` per event). The AI never performs timezone conversion or date arithmetic — it only inserts pre-computed strings. This is critical; AI TZ math is a recurring source of bugs.

**Pre-filter vs validator**: prefilter removes events the user *cannot physically attend* (calendar conflicts) before the AI ranks them. The validator checks the AI's *output* for rule violations and hallucinations, triggering corrective retries. They're complementary layers, not redundant.

**Corrective retry**: when validation fails, the curator builds a corrective prompt naming each violation, retries the same model once, then falls back to the next model if still invalid.

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

4. **For `invalid_grant`**: requires human action (browser OAuth flow). Provide: `node index.js --auth`.

5. **For Gemini API issues**: the 2-model fallback chain handles transient failures automatically. If both models failed, check https://status.cloud.google.com/ for outages.

6. **For scraper failures**: check if the source URL still works, then inspect `src/scrapers/` for selector or API changes.

7. **For validation failures with no model fallback left**: inspect the most recent `runs/*.json` artifact — it contains the exact prompt and raw HTML returned, plus the validator stats that failed.

## Testing

```bash
npm test          # run all tests
npm run dry-run   # full pipeline without sending email
```
