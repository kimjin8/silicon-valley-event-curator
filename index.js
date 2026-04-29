// ============================================================
// Weekly Startup Events Curator — Main Entry Point
// ============================================================
//
// USAGE:
//   node index.js          Run the full pipeline once (scrape -> curate -> email)
//   node index.js --auth   Set up Google authorization (first-time only)
//   node index.js --dry-run Run pipeline but skip sending the email (prints HTML)
//   node index.js --cron   Run on a schedule (every Monday at 10am PT)
//
// THE PIPELINE:
//   1. Compute the date range (today -> 7 days from now)
//   2. Scrape events from 3 sources (sequentially, each with own browser)
//   3. Fetch your Google Calendar events (in parallel with scraping)
//   4. Filter calendar to only "busy" events
//   5. Merge all data together
//   6. Send to Gemini AI for curation + HTML email generation
//   7. Send the email via Gmail
// ============================================================

// Force immediate logging flush
console.log("--- CONTAINER STARTING ---");
process.stdout.write("Checking environment...\n");
// Load environment variables from .env file BEFORE anything else
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { validateConfig } = require("./src/config");
const { getGoogleAuthClient, authenticateGoogle } = require("./src/auth");
const { scrapeCerebralValley } = require("./src/scrapers/cerebral-valley");
const { scrapeLumaSF } = require("./src/scrapers/luma-sf");
const { scrapeSFIRL } = require("./src/scrapers/sf-irl");
const { getCalendarEvents, filterBusyEvents } = require("./src/calendar");
const { curateEventsWithAI } = require("./src/curator");
const { prefilterMergedData } = require("./src/prefilter");
const { sendEmail } = require("./src/email");

/**
 * Persist a full snapshot of one pipeline run for post-hoc diagnosis.
 * Writes runs/<ISO-timestamp>.json containing scraped events, calendar,
 * the exact prompt sent to Gemini, and the raw HTML returned.
 *
 * Returns the artifact path, or null if writing failed (non-fatal — we
 * never want tracing to break a real run).
 */
function writeRunArtifact(artifact) {
  try {
    const runsDir = path.join(__dirname, "runs");
    if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(runsDir, `${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(artifact, null, 2));
    return file;
  } catch (err) {
    console.error("⚠ Failed to write run artifact:", err.message);
    return null;
  }
}

/**
 * Calculate the date range for the upcoming week, plus pre-formatted
 * Pacific Time labels for the AI to use verbatim. We pre-compute these
 * because handing the AI raw ISO timestamps and asking it to format them
 * has been a recurring source of bugs (it interprets UTC as PT after 5pm,
 * mislabels day-of-week, etc.). The AI just inserts these strings.
 *
 * Returns:
 *   timeMin / timeMax — ISO strings (UTC) for Google Calendar API
 *   todayPT — "Tuesday, April 28, 2026" (today in PT)
 *   weekLabelPT — "April 28 – May 5, 2026" (header label in PT)
 *   weekStartPT — "April 28" (start day, PT)
 *   weekEndPT — "May 5"   (end day, PT)
 */
function computeDateRange() {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const tz = "America/Los_Angeles";
  const fullDate = (d) =>
    d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: tz,
    });
  const shortDate = (d) =>
    d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: tz });
  const yearOf = (d) =>
    d.toLocaleDateString("en-US", { year: "numeric", timeZone: tz });
  return {
    timeMin: now.toISOString(),
    timeMax: weekFromNow.toISOString(),
    todayPT: fullDate(now),
    weekStartPT: shortDate(now),
    weekEndPT: shortDate(weekFromNow),
    weekLabelPT: `${shortDate(now)} – ${shortDate(weekFromNow)}, ${yearOf(weekFromNow)}`,
  };
}

/**
 * Run the complete event curation pipeline.
 *
 * @param {object} options
 * @param {boolean} options.dryRun - If true, skip sending email (print HTML)
 */
async function runWorkflow({ dryRun = false } = {}) {
  console.log("\n========================================");
  console.log("🚀 Weekly Startup Events Curator");
  console.log(
    "   " +
    new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) +
    " PT"
  );
  console.log("========================================\n");

  // Step 1: Compute date range
  const dateRange = computeDateRange();
  console.log(`📆 Today (PT): ${dateRange.todayPT}`);
  console.log(`📆 Week label: ${dateRange.weekLabelPT}`);

  // Google auth
  let authClient = null;
  try {
    authClient = await getGoogleAuthClient();
  } catch (err) {
    console.error("❌ Google auth failed:", err.message);
    if (!dryRun) throw err;
    console.warn("⚠ Continuing without Google auth (dry-run mode)");
  }

  // Step 2 & 3: Scrape + Calendar (calendar runs in parallel with scraping)
  const calendarPromise = authClient
    ? getCalendarEvents(authClient, dateRange)
    : Promise.resolve([]);

  // Run scrapers sequentially — each launches its own browser
  const cerebralValley = await scrapeCerebralValley();
  const lumaSF = await scrapeLumaSF();
  const sfIrl = await scrapeSFIRL();
  const calendarEvents = await calendarPromise;

  // Step 4: Filter busy events
  const busyEvents = filterBusyEvents(calendarEvents);

  // Check: did ALL scrapers fail?
  if (cerebralValley.error && lumaSF.error && sfIrl.error) {
    console.error("\n❌ All 3 scrapers failed. Aborting pipeline.");
    console.error("   Cerebral Valley:", cerebralValley.error);
    console.error("   Luma SF:", lumaSF.error);
    console.error("   SF IRL:", sfIrl.error);
    console.error("\n   No email will be sent (an empty digest is useless).");
    return;
  }

  // Step 5: Merge all data
  const rawMergedData = {
    dateRange: {
      from: dateRange.timeMin,
      to: dateRange.timeMax,
      todayPT: dateRange.todayPT,
      weekStartPT: dateRange.weekStartPT,
      weekEndPT: dateRange.weekEndPT,
      weekLabelPT: dateRange.weekLabelPT,
    },
    cerebralValleyEvents: cerebralValley,
    lumaSFEvents: lumaSF,
    sfIrlEvents: sfIrl,
    busyCalendarEvents: busyEvents,
  };

  // Pre-filter hard physical invariants (calendar overlap + blocked evenings)
  // before the AI sees the data. The AI keeps full ownership of judgment
  // (interest, ranking, region, price) — we just remove events you literally
  // cannot attend. Validator still runs on the AI's output as a safety net.
  const { mergedData, prefilterReport } = prefilterMergedData(rawMergedData);
  console.log(
    `\n🛡  Pre-filter: dropped ${prefilterReport.droppedCount} un-attendable events ` +
      `(Luma ${prefilterReport.luma.before}→${prefilterReport.luma.after}, ` +
      `CV ${prefilterReport.cerebralValley.before}→${prefilterReport.cerebralValley.after})`
  );
  prefilterReport.drops.slice(0, 10).forEach((d) => {
    console.log(`     · ${d.datePT} ${d.startTimePT} — ${d.name} [${d.reason}]`);
  });
  if (prefilterReport.drops.length > 10) {
    console.log(`     · ...and ${prefilterReport.drops.length - 10} more`);
  }

  console.log("\n📊 Merged data ready. Sending to AI for curation...\n");

  // Log which sources succeeded
  const sources = [
    { name: "Cerebral Valley", ok: !cerebralValley.error },
    { name: "Luma SF", ok: !lumaSF.error },
    { name: "SF IRL", ok: !sfIrl.error },
  ];
  sources.forEach((s) => console.log(`   ${s.ok ? "✅" : "❌"} ${s.name}`));
  console.log();

  // Step 6: AI curation
  const { html: htmlEmail, prompt, modelUsed, finishReason, usage, attempts } =
    await curateEventsWithAI(mergedData);

  // Persist a full run artifact for post-hoc diagnosis.
  // Written BEFORE email send so a send failure still leaves a trace.
  const artifactPath = writeRunArtifact({
    runAt: new Date().toISOString(),
    dryRun,
    dateRange,
    sources: {
      cerebralValley,
      lumaSF,
      sfIrl,
    },
    calendar: {
      totalEvents: calendarEvents.length,
      busyEvents,
    },
    prefilter: prefilterReport,
    ai: {
      prompt,
      promptChars: prompt.length,
      modelUsed,
      finishReason,
      usage,
      attempts,
      html: htmlEmail,
      htmlChars: htmlEmail.length,
    },
  });
  if (artifactPath) console.log(`📝 Run artifact: ${artifactPath}`);

  // Step 7: Send email (or print in dry-run mode)
  if (dryRun) {
    console.log("\n========================================");
    console.log("🏜️  DRY RUN — Email not sent");
    console.log("========================================\n");
    console.log("Generated HTML:\n");
    console.log(htmlEmail);
    console.log("\n(Paste the above HTML into a browser to preview)\n");
  } else {
    if (!authClient) {
      throw new Error("Cannot send email: Google auth is not set up.");
    }
    await sendEmail(authClient, htmlEmail);
  }

  console.log("\n========================================");
  console.log("✅ Workflow complete!");
  console.log("========================================\n");
}

// ============================================================
// CLI ENTRY POINT
// ============================================================

(async () => {
  const args = process.argv.slice(2);

  // --auth: Google OAuth flow
  if (args.includes("--auth")) {
    console.log("🔐 Starting Google authorization flow...\n");
    await authenticateGoogle();
    process.exit(0);
  }

  // Validate config before running the pipeline
  validateConfig();

  // --cron: Scheduled mode (every Monday at 10:00 AM)
  if (args.includes("--cron")) {
    console.log("⏰ Cron mode: will run every Monday at 10:00 AM (system timezone)");
    console.log("   Set TZ=America/Los_Angeles for Pacific Time\n");

    cron.schedule("0 10 * * 1", () => {
      runWorkflow().catch(console.error);
    });

    console.log("   Waiting for next scheduled run...");
    return;
  }

  // --dry-run: Test without sending email
  if (args.includes("--dry-run")) {
    await runWorkflow({ dryRun: true });
    process.exit(0);
  }

  // Default: Run once and send email
  await runWorkflow();
  process.exit(0);
})().catch((err) => {
  console.error("\n💥 Fatal error:", err.message || err);
  console.error(err.stack);
  process.exit(1);
});
