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
 * Calculate the date range for the upcoming week.
 * @returns {object} Date range with timeMin and timeMax (ISO strings)
 */
function computeDateRange() {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    timeMin: now.toISOString(),
    timeMax: weekFromNow.toISOString(),
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
  console.log("📆 Date range:", dateRange.timeMin, "to", dateRange.timeMax);

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
  const mergedData = {
    dateRange: { from: dateRange.timeMin, to: dateRange.timeMax },
    cerebralValleyEvents: cerebralValley,
    lumaSFEvents: lumaSF,
    sfIrlEvents: sfIrl,
    busyCalendarEvents: busyEvents,
  };

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
