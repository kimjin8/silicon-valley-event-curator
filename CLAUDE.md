# Claude Code Project Instructions

This is a Node.js pipeline that scrapes Bay Area tech events, asks Gemini AI for a verdict on each, renders a weekly HTML digest in code, and emails it.

## Project Layout

- `index.js` — entry point, orchestration, PT-formatted date range computation
- `src/config.js` — env vars, Gemini model names, scraper settings
- `src/curator.js` — builds the candidate list (structured events with URLs, deduped, region-tagged) and asks Gemini for a JSON verdict per candidate id (`shortlist` / `radar` / `skip` + blurb); 2-model fallback chain (primary → lite), each with one corrective-feedback retry
- `src/render.js` — renders the HTML digest deterministically from verdicts + candidate data; every link, date, time, and location comes from the candidate record
- `src/prefilter.js` — drops events with hard calendar conflicts before AI sees data (physics, not preference)
- `src/validator.js` — checks the AI's JSON verdicts: known ids only, valid verdicts, coverage floor
- `src/locations.js` — non-Bay-Area city detection and `regionOf` (SF / South Bay / Peninsula / East Bay)
- `src/scrapers/` — cerebral-valley.js, luma-sf.js, sf-irl.js, utils.js (shared retry/browser logic, `toPacificTime`, `formatTimeRange`)
- `src/calendar.js` — Google Calendar fetch + busy-event filter
- `src/email.js` — Gmail sender
- `user-config.js` — user preferences (interests, schedule, cost) — the one file users edit
- `runs/` — per-run diagnostic artifacts (gitignored): scraped events, prompt, raw HTML, validation stats
- `RUNBOOK.md` — operational incident history and fixes (gitignored)

## Architecture Notes

**Judgement-only AI**: the AI never writes a URL, a date, a location, or HTML. It receives candidates by id and returns verdicts by id; `render.js` looks each id back up and prints the candidate's own fields. This replaced an AI-writes-the-email design that attached other events' links to its picks and resurfaced prefiltered events it had seen in the scrapers' raw text (INC-008, 2026-09-07). Only structured events with a registration URL become candidates; SF IRL newsletter text is passed as signal only.

**Date/time handling**: all user-facing date labels are pre-formatted in Pacific Time by the scrapers (`dayOfWeek`, `datePT`, `displayTime` per event) and `index.js` (`weekLabelPT`). AI TZ math is a recurring source of bugs, so the AI never sees a raw timestamp.

**Pre-filter vs validator**: prefilter removes events the user *cannot physically attend* (calendar conflicts, travel) before they become candidates. The validator checks the AI's *verdicts* are well-formed and non-empty, triggering a corrective retry.

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
   - `Response was not valid JSON` → model ignored the JSON schema; corrective retry / fallback handles it
   - `ENOENT: google-credentials.json` → deployed code missing env var fallback (INC-005)
   - `Cannot find module` → missing files in Docker image
   - `All 3 scrapers failed` → source websites changed

4. **For `invalid_grant`**: requires human action (browser OAuth flow). Provide: `node index.js --auth`.

5. **For Gemini API issues**: the 2-model fallback chain handles transient failures automatically. If both models failed, check https://status.cloud.google.com/ for outages.

6. **For scraper failures**: check if the source URL still works, then inspect `src/scrapers/` for selector or API changes.

7. **For validation failures with no model fallback left**: inspect the most recent `runs/*.json` artifact — it contains the candidates, the exact prompt, the raw JSON returned, the cleaned decisions, and the rendered HTML.

## Testing

```bash
npm test          # run all tests
npm run dry-run   # full pipeline without sending email
```
