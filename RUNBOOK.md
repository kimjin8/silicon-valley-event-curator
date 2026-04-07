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

## Monitoring & Alerts

| What | How |
|------|-----|
| Job failure alert | Cloud Monitoring policy "Event Curator Job Failed" — emails hongkimjin@gmail.com on fatal errors, exit(1), or task timeout |
| Cloud Scheduler status | `gcloud scheduler jobs describe startup-event-curator-weekly --location=us-west1` |
| Manual job execution | `gcloud run jobs execute startup-event-curator --region=us-west1` |

---

## Common Fixes

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `invalid_grant` | OAuth token expired | Re-auth: `node index.js --auth`, then update Cloud Run env var |
| `fetch failed` / timeout | Gemini API unresponsive | Automatic fallback handles this; check [Gemini status](https://status.cloud.google.com/) if all 3 fail |
| `503 Service Unavailable` | Gemini model overloaded | Automatic fallback handles this |
| `Cannot find module` | Missing files in Docker image | Rebuild and push: `gcloud builds submit ...` |
| `All 3 scrapers failed` | Source websites changed layout | Check each scraper URL manually; update selectors in `src/scrapers/` |
| `Terminating task...maximum timeout` | Job took too long | Check which step hung in logs; likely Gemini API (see INC-004) |
