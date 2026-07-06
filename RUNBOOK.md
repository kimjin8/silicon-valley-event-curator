# Ops Runbook — Silicon Valley Event Curator

This document records past operational incidents, their root causes, fixes, and preventive measures. It is intended for human operators and AI coding agents diagnosing failures.

---

## How to Check Job Status

```bash
# View recent executions
gcloud run jobs executions list --job=startup-event-curator --region=us-west1

# Read logs from the last run
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="startup-event-curator"' \
  --limit=50 --format="table(timestamp,severity,textPayload)" --project=startup-event-curator

# Check Cloud Scheduler status
gcloud scheduler jobs describe startup-event-curator-weekly --location=us-west1
```

---

## Incident Log

### INC-001: Truncated HTML email (2026-03-30)

**Symptom**: Email arrived but was cut off mid-HTML — missing closing tags, incomplete layout.

**Root cause**: Gemini model stopped generating before completing the HTML (`finishReason` was not `STOP`). The code did not check `finishReason` and sent the partial output.

**Fix**: Added `finishReason` check in `src/curator.js`. If `finishReason !== "STOP"`, the output is treated as a failure and the next model in the fallback chain is tried.

**Prevention**: The truncation guard now logs `finishReason` and token counts for every successful generation, making it easy to spot partial outputs.

---

### INC-002: Job did not run — no Cloud Scheduler (2026-03-30)

**Symptom**: The Monday morning cron job did not execute. No email was received.

**Root cause**: Cloud Scheduler had never been set up. The Cloud Run Job existed but nothing triggered it on a schedule.

**Fix**: Created Cloud Scheduler job `startup-event-curator-weekly` with cron `0 10 * * 1` in `America/Los_Angeles` timezone, using a service account with `roles/run.invoker`.

**Prevention**: Cloud Monitoring alert policy "Event Curator Job Failed" now sends an email when the job fails or times out.

---

### INC-003: OAuth token expired — `invalid_grant` (2026-04-06)

**Symptom**: Cloud Scheduler triggered the job on time, but the job failed immediately with `Error: invalid_grant` during Google auth. Logs showed:
```
🔄 Google token expired, refreshing...
Error: invalid_grant
❌ Google auth failed: Failed to refresh Google token. Please re-authorize
```

**Root cause**: Google OAuth apps in "Testing" mode issue refresh tokens that expire after **7 days**. The token was generated on 2026-03-30 and expired by 2026-04-06.

**Fix**: Re-authorized locally (`node index.js --auth`), updated Cloud Run env var `GOOGLE_TOKEN_JSON` with the fresh token.

**Prevention**: Published the OAuth app from "Testing" to "Production" mode in Google Cloud Console. Published apps issue long-lived refresh tokens that don't expire on a 7-day cycle. To verify: [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent).

**If it recurs**: Run `node index.js --auth` locally, then update the Cloud Run job:
```bash
TOKEN_JSON=$(cat google-token.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))")
gcloud run jobs update startup-event-curator --region=us-west1 \
  --update-env-vars "^##^GOOGLE_TOKEN_JSON=${TOKEN_JSON}"
```

---

### INC-004: Gemini API hang — 5-minute unresponsive call (2026-04-07)

**Symptom**: Job scraped all 3 sources successfully (~30s), then hung on the Gemini API call for 5+ minutes. The Cloud Run task timed out at 300s. On retry, the primary model hung again, and the first fallback returned 503. Only the stable fallback (Gemini 2.5 Flash Lite) succeeded.

**Timeline**:
- `15:47:37` — Started Gemini 3 Flash Preview call
- `15:52:02` — Cloud Run killed task (300s timeout)
- `15:53:37` — Retry: started Gemini 3 Flash Preview again
- `15:58:38` — Primary failed: `fetch failed` (network timeout after ~5 min)
- `15:58:38` — Tried Gemini 3.1 Flash Lite
- `16:01:14` — Fallback failed: `503 Service Unavailable` ("high demand")
- `16:01:14` — Tried Gemini 2.5 Flash Lite (stable fallback)
- `16:01:48` — Stable fallback succeeded (14,664 chars, finishReason: STOP)

**Root cause**: No request-level timeout on the Gemini `generateContent()` call. When the API is slow or unresponsive, the code waits indefinitely until Cloud Run kills the container.

**Fix**:
1. Added `AI_REQUEST_TIMEOUT_MS` (120s) in `src/config.js`
2. Wrapped `generateContent()` in `Promise.race()` with a timeout in `src/curator.js`
3. Increased Cloud Run task timeout to 600s (enough for scraping + up to 3 model attempts)

**Prevention**: With the 120s timeout, a hanging model triggers fallback in 2 minutes instead of 5. The 3-model fallback chain (primary → fallback → stable) provides resilience against model-specific outages.

---

### INC-005: auth.js regression + silent alerts (2026-04-13)

**Symptom**: Scheduled Monday job failed at 10:00 AM PT. No alert email was received despite the alert policy being enabled. Logs showed:
```
ENOENT: no such file or directory, open '/app/google-credentials.json'
```

**Root cause (crash)**: Local uncommitted changes to `src/auth.js` removed the `GOOGLE_CREDENTIALS_JSON` / `GOOGLE_TOKEN_JSON` env var fallback, replacing it with direct `fs.readFileSync()` calls. A `gcloud builds submit` was run from the working directory before committing, so the broken code was baked into the Docker image. The container has no credentials files on disk — it relies entirely on env vars injected at runtime.

**Root cause (silent alert)**: The Cloud Monitoring alert condition required `severity>=ERROR`, but Cloud Run logs "Container called exit(1)." at `WARNING` severity. No single log entry matched both `severity>=ERROR` AND the text patterns, so the alert never fired.

**Note on token**: The `GOOGLE_TOKEN_JSON` in Cloud Run included `refresh_token_expires_in: 604799` (7 days) in the response payload, but the OAuth app was already published to production mode before the token was issued. Production-mode refresh tokens do not expire on a 7-day cycle — the field is informational only. The token was still valid; the crash occurred before any token check.

**Timeline**:
- `17:00:05 UTC` — Cloud Scheduler triggered `startup-event-curator-m6qnx`
- `17:01:02 UTC` — Container started, dotenv loaded
- `17:01:05 UTC` — Crashed: `ENOENT: no such file or directory, open '/app/google-credentials.json'`
- `17:01:06 UTC` — Container retried, crashed with same error
- `17:01:26 UTC` — `exit(1)` — no alert email sent (alert policy bug)
- (Investigation began same evening)
- Reverted `src/auth.js` to committed version via `git checkout src/auth.js`
- Updated alert policy filter: `severity>=ERROR` → `severity>=WARNING`
- Verified fix locally with `npm run dry-run` — full pipeline succeeded
- Rebuilt Docker image via `gcloud builds submit`, updated Cloud Run image
- Manually triggered execution `startup-event-curator-6bzdb`
- `05:20:11 UTC (Apr 14)` — Job started, token refreshed, all 3 scrapers succeeded
- `05:22:42 UTC` — Primary model timed out (120s), fallback hit 503, stable fallback (Gemini 2.5 Flash Lite) succeeded
- `05:23:11 UTC` — Email sent (Message ID: `19d8a718e87e2ca5`), `exit(0)`

**Fixes applied**:
1. Reverted `src/auth.js` to committed version (restored env var fallback) via `git checkout src/auth.js`
2. Fixed alert policy filter: `severity>=ERROR` → `severity>=WARNING` so "Container called exit(1)." warnings trigger alerts
3. Rebuilt Docker image and redeployed to Cloud Run
4. Manually triggered job — email sent successfully

**If it recurs** (code deployed without env var fallback):
```bash
# 1. Check the deployed auth.js has env var support
gcloud run jobs describe startup-event-curator --region=us-west1 \
  --format="value(spec.template.spec.template.spec.containers[0].image)"
# 2. Revert local changes and rebuild
git checkout src/auth.js
gcloud builds submit --tag gcr.io/startup-event-curator/event-curator
gcloud run jobs update startup-event-curator --region=us-west1 \
  --image gcr.io/startup-event-curator/event-curator
# 3. Trigger a manual run
gcloud run jobs execute startup-event-curator --region=us-west1
```

**Prevention**:
- Always commit before running `gcloud builds submit` — the build context includes the working tree, not just committed files
- Alert policy now uses `severity>=WARNING` to catch exit(1) warnings
- The `src/auth.js` env var fallback is critical for Cloud Run — never remove it

---

### INC-006: OAuth token expired — `invalid_grant` on Cloud Run (2026-04-18)

**Symptom**: Manually triggered Cloud Run job failed with `invalid_grant` during Google auth, identical to INC-003.

**Root cause**: The refresh token stored in `GOOGLE_TOKEN_JSON` on Cloud Run had expired. The OAuth app is in Production mode, so this was NOT the 7-day Testing-mode expiry from INC-003. Exact cause of token invalidation is unclear — possible causes include user revoking access, Google security policy, or token corruption.

**Fix**: Re-authorized locally (`node index.js --auth`), updated Cloud Run env var with fresh token:
```bash
TOKEN_JSON=$(cat google-token.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))")
gcloud run jobs update startup-event-curator --region=us-west1 --project=startup-event-curator \
  --update-env-vars "^##^GOOGLE_TOKEN_JSON=${TOKEN_JSON}"
gcloud run jobs execute startup-event-curator --region=us-west1 --project=startup-event-curator
```

**Result**: Job succeeded — all 3 scrapers passed, primary model (Gemini 3 Flash Preview) succeeded, email sent (Message ID: `19da13b93aa9ad63`).

### INC-007: Fallback model truncated — `thinkingBudget` ignored by Gemini 3 (2026-07-06)

**Symptom**: Weekly job (execution `startup-event-curator-zp86l`) failed with `All AI models failed`. Primary (Gemini 3 Flash Preview) hit a transient `503 Service Unavailable` (high demand); the fallback (Gemini 3.1 Flash Lite) returned `finishReason: MAX_TOKENS` — truncated HTML. Only failed because *both* legs failed the same run.

**Root cause**: The fallback truncated because thinking consumed the entire token budget. The generation config set `thinkingConfig.thinkingBudget: 8192`, but Gemini 3 **silently ignores the numeric `thinkingBudget` on hard prompts** — the failed run logged `thinking: 62910` tokens (7.7× the "budget"), leaving only 2622 for output against `maxOutputTokens: 65536`. Reproduced deterministically by replaying the real 117k-char prompt through `gemini-3.1-flash-lite` with the old config: `thinking=62915, finish=MAX_TOKENS`. Note `thinkingBudget` *is* respected on easy prompts, which is why it went unnoticed.

**Fix**: Gemini 3's `thinkingConfig.thinkingLevel: "low"` **is** honored (~3–4k thinking tokens even on the hard prompt → complete, well-formed HTML). Extracted `buildGenerationConfig(name)` in `src/curator.js`: Gemini 3 → `thinkingLevel: "low"`, Gemini 2.5 → `thinkingBudget` (unchanged). Regression test in `tests/curator.test.js`. Committed `38d35bf`, rebuilt image, redeployed job.

**Result**: Re-ran the job (execution `startup-event-curator-526q5`). Primary 503'd again (still under high demand) → fell back to Flash Lite, which now returned `thinking=2990, finish=STOP`; corrective retry passed validation at 11,475 chars; **email sent** (Message ID: `19f38e1d9a43de17`). Fix verified under the identical triggering condition.

**Prevention**: When a Gemini 3 model appears to overrun `maxOutputTokens`, check `thoughtsTokenCount` in the logged token line — runaway thinking (not output length) is the usual cause. Cap it with `thinkingLevel`, not `thinkingBudget`.

---

## Monitoring & Alerts

| What | How |
|------|-----|
| Job failure alert | Cloud Monitoring policy "Event Curator Job Failed" — emails the operator (`RECIPIENT_EMAIL`) on `severity>=WARNING` matching fatal errors, exit(1), or task timeout |
| Cloud Scheduler status | `gcloud scheduler jobs describe startup-event-curator-weekly --location=us-west1` |
| Manual job execution | `gcloud run jobs execute startup-event-curator --region=us-west1` |

---

## Common Fixes

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `invalid_grant` | OAuth token expired | Re-auth: `node index.js --auth`, then update Cloud Run env var |
| `fetch failed` / timeout | Gemini API unresponsive | Automatic fallback handles this; check [Gemini status](https://status.cloud.google.com/) if all 3 fail |
| `503 Service Unavailable` | Gemini model overloaded | Automatic fallback handles this |
| `finishReason: MAX_TOKENS` with high `thinking:` count | Gemini 3 ran away on thinking, starving output | Cap with `thinkingLevel` not `thinkingBudget` (INC-007) |
| `ENOENT: google-credentials.json` | Deployed code missing env var fallback | Revert auth.js to committed version, rebuild Docker image |
| `Cannot find module` | Missing files in Docker image | Rebuild and push: `gcloud builds submit ...` |
| `All 3 scrapers failed` | Source websites changed layout | Check each scraper URL manually; update selectors in `src/scrapers/` |
| `Terminating task...maximum timeout` | Job took too long | Check which step hung in logs; likely Gemini API (see INC-004) |

---

## Deployment Checklist

When rebuilding and redeploying the Cloud Run job, follow these steps in order:

```bash
# 1. Verify no uncommitted changes will break the build (INC-005 lesson)
git status
# If auth.js has local changes, verify env var fallback is intact:
grep "GOOGLE_CREDENTIALS_JSON\|GOOGLE_TOKEN_JSON" src/auth.js

# 2. Run a local dry-run to catch errors before deploying
npm run dry-run

# 3. Build and push the Docker image
gcloud builds submit --tag gcr.io/startup-event-curator/event-curator --project=startup-event-curator

# 4. Update the Cloud Run job to use the new image
gcloud run jobs update startup-event-curator --region=us-west1 \
  --image gcr.io/startup-event-curator/event-curator

# 5. (Optional) If token was refreshed locally, update the env var
TOKEN_JSON=$(cat google-token.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))")
gcloud run jobs update startup-event-curator --region=us-west1 \
  --update-env-vars "^##^GOOGLE_TOKEN_JSON=${TOKEN_JSON}"

# 6. Trigger a manual run to verify
gcloud run jobs execute startup-event-curator --region=us-west1

# 7. Check execution status
gcloud run jobs executions list --job=startup-event-curator --region=us-west1 --limit=1
```

### Key things to verify before deploying

- `src/auth.js` still reads from `GOOGLE_CREDENTIALS_JSON` and `GOOGLE_TOKEN_JSON` env vars first, with file fallback for local dev
- `npm run dry-run` completes successfully end-to-end
- Secrets (`.env`, `google-credentials.json`, `google-token.json`) are in `.gitignore` and NOT committed

---

## Architecture Notes

### Auth flow: Cloud Run vs. local

The app authenticates with Google APIs (Calendar, Gmail) using OAuth2. The credentials and tokens are stored differently depending on the environment:

| | Local development | Cloud Run |
|---|---|---|
| App credentials | `google-credentials.json` file | `GOOGLE_CREDENTIALS_JSON` env var |
| User token | `google-token.json` file | `GOOGLE_TOKEN_JSON` env var |
| Token refresh | Writes refreshed token back to file | Cannot persist (container is ephemeral) |

`src/auth.js` checks env vars first (Cloud Run path), then falls back to files (local path). **This dual-path logic is critical** — removing either path breaks one environment. See INC-005.

### Gemini fallback chain

The AI curation step uses a 3-model fallback chain defined in `src/config.js`:

1. **Gemini 3 Flash Preview** (primary) — fastest, most capable
2. **Gemini 3.1 Flash Lite** (fallback) — lighter, avoids primary outages
3. **Gemini 2.5 Flash Lite** (stable) — older but consistently available

Each model gets a 120s timeout (`AI_REQUEST_TIMEOUT_MS`). If a model times out or returns an error, the next model is tried. See INC-004.

### Scraper architecture

All 3 scrapers share a common retry + browser lifecycle pattern via `src/scrapers/utils.js`:

- `withBrowserRetry(sourceName, scrapeFn, emptyResult)` — launches a fresh Chromium browser per attempt, retries up to `SCRAPER_MAX_RETRIES` times, always closes the browser
- `BROWSER_LAUNCH_OPTIONS` — consistent headless Chromium flags (no-sandbox, disable-gpu, etc.)
- Each scraper calls `withBrowserRetry` with its own scrape logic, eliminating duplicate retry/browser code

Scrapers no longer accept `browserLaunchOptions` as a parameter — the options are defined in `utils.js`.

### User availability & schedule preferences

**Current setting** (updated 2026-04-18): `availability: "all-day"` — user is a full-time founder, available daytime and evening.

**Previous setting** (before 2026-04-18): `availability` field did not exist — user had a day job and was only available evenings.

The schedule filter in `src/curator.js` uses this field to tell the AI about the user's availability. The weekday location preference is a **soft preference**, not a hard rule:
- **South Bay** weekday events → shortlisted
- **SF** weekday events → placed in "Also On Your Radar" with "SF on Weekday" badge (user CAN attend, just prefers South Bay)
- **SF** weekend events → shortlisted normally

To change: edit `schedule.availability` in `user-config.js` to `"evening-only"` or `"all-day"`.

---

### OAuth app status

The Google OAuth app is published in **Production** mode (verified 2026-04-13). This means:
- Refresh tokens do **not** expire on a 7-day cycle (unlike Testing mode — see INC-003)
- The `refresh_token_expires_in` field in token responses is informational only
- To verify: [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent?project=startup-event-curator)
