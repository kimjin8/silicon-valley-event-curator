// ============================================================
// Weekly Startup Events Curator — Main Entry Point
// ============================================================
//
// This is the main file that orchestrates the entire pipeline.
// Think of it like a recipe: it calls each step in order.
//
// USAGE:
//   node index.js          Run the full pipeline once (scrape → curate → email)
//   node index.js --auth   Set up Google authorization (first-time only)
//   node index.js --dry-run Run pipeline but skip sending the email (prints HTML)
//   node index.js --cron   Run on a schedule (every Monday at 10am PT)
//
// THE PIPELINE:
//   1. Compute the date range (today → 7 days from now)
//   2. Scrape events from 3 sources (in parallel for speed)
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


const cron = require("node-cron");
const { validateConfig } = require("./src/config");
const { getGoogleAuthClient, authenticateGoogle } = require("./src/auth");
const { scrapeCerebralValley } = require("./src/scrapers/cerebral-valley");
const { scrapeLumaSF } = require("./src/scrapers/luma-sf");
const { scrapeSFIRL } = require("./src/scrapers/sf-irl");
const { getCalendarEvents, filterBusyEvents } = require("./src/calendar");
const { curateEventsWithAI } = require("./src/curator");
const { sendEmail } = require("./src/email");

// ============================================================
// STEP 1: Compute Date Range
// ============================================================

/**
 * Calculate the date range for the upcoming week.
 *
 * Returns ISO date strings for "right now" and "7 days from now".
 * These are used to:
 *   - Tell Google Calendar which events to fetch
 *   - Tell the AI what time period we're looking at
 *
 * @returns {object} Date range with timeMin and timeMax
 */
function computeDateRange() {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    now: now.toISOString(),
    weekFromNow: weekFromNow.toISOString(),
    timeMin: now.toISOString(),
    timeMax: weekFromNow.toISOString(),
  };
}

// ============================================================
// MAIN WORKFLOW
// ============================================================

/**
 * Run the complete event curation pipeline.
 *
 * This is the heart of the program. It executes all 7 steps
 * of the pipeline in order, with the scraping and calendar
 * steps running in parallel for faster execution.
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

  // ── Step 1: Compute date range ──────────────────────────
  const dateRange = computeDateRange();
  console.log("📆 Date range:", dateRange.timeMin, "to", dateRange.timeMax);

  // ── Google auth ─────────────────────────────────────────
  // Get an authenticated client for Calendar + Gmail.
  // This checks the saved token and refreshes it if expired.
  let authClient = null;
  try {
    authClient = await getGoogleAuthClient();
  } catch (err) {
    console.error("❌ Google auth failed:", err.message);
    if (!dryRun) {
      // Can't send email without auth, so we abort
      throw err;
    }
    console.warn("⚠ Continuing without Google auth (dry-run mode)");
  }

  // ── Step 2 & 3: Scrape + Calendar ──────────────────────
  // Each scraper launches its own headless browser and closes it
  // when done. This avoids a Chrome bug where --single-process mode
  // kills the browser after the first page closes.
  {
    // Each scraper launches its own browser instance and closes it
    // when done. The --single-process flag (previously used) causes
    // the browser to die after the first page closes, so we avoid
    // sharing a single browser across scrapers.
    const browserLaunchOptions = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ]
    };

    // Calendar fetch runs in parallel with scraping since it uses
    // the Google API (no browser needed).
    const calendarPromise = authClient
      ? getCalendarEvents(authClient, dateRange)
      : Promise.resolve([]);

    // Run scrapers sequentially — each one launches its own browser
    const cerebralValley = await scrapeCerebralValley(browserLaunchOptions);
    const lumaSF = await scrapeLumaSF(browserLaunchOptions);
    const sfIrl = await scrapeSFIRL(browserLaunchOptions);
    const calendarEvents = await calendarPromise;

    // ── Step 4: Filter busy events ──────────────────────
    const busyEvents = filterBusyEvents(calendarEvents);

    // ── Check: did ALL scrapers fail? ────────────────────
    const allFailed =
      cerebralValley.error && lumaSF.error && sfIrl.error;

    if (allFailed) {
      console.error("\n❌ All 3 scrapers failed. Aborting pipeline.");
      console.error("   Cerebral Valley:", cerebralValley.error);
      console.error("   Luma SF:", lumaSF.error);
      console.error("   SF IRL:", sfIrl.error);
      console.error("\n   No email will be sent (an empty digest is useless).");
      return;
    }

    // ── Step 5: Merge all data ──────────────────────────
    // Combine all sources into a single object for the AI.
    // This is what gets sent to Gemini as input.
    const mergedData = {
      dateRange: {
        from: dateRange.timeMin,
        to: dateRange.timeMax,
      },
      cerebralValleyEvents: cerebralValley,
      lumaSFEvents: lumaSF, // Includes .events array with individual links
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
    sources.forEach((s) =>
      console.log(`   ${s.ok ? "✅" : "❌"} ${s.name}`)
    );
    console.log();

    // ── Step 6: AI curation ─────────────────────────────
    const htmlEmail = await curateEventsWithAI(mergedData);

    // ── Step 7: Send email (or print in dry-run mode) ───
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
}

// ============================================================
// CLI ENTRY POINT
// ============================================================
//
// This section handles command-line arguments:
//   --auth     → Run the Google OAuth flow (first-time setup)
//   --cron     → Run on a weekly schedule
//   --dry-run  → Run once without sending email
//   (default)  → Run once and send email

(async () => {
  const args = process.argv.slice(2);

  // ── --auth: Google OAuth flow ────────────────────────────
  if (args.includes("--auth")) {
    console.log("🔐 Starting Google authorization flow...\n");
    await authenticateGoogle();
    process.exit(0);
  }

  // Validate config before running the pipeline
  validateConfig();

  // ── --cron: Scheduled mode ───────────────────────────────
  if (args.includes("--cron")) {
    // Schedule the workflow to run every Monday at 10:00 AM.
    // The cron expression "0 10 * * 1" means:
    //   0  → minute 0 (at the top of the hour)
    //   10 → hour 10 (10 AM)
    //   *  → any day of month
    //   *  → any month
    //   1  → Monday (day of week, 0=Sunday, 1=Monday)
    console.log(
      "⏰ Cron mode: will run every Monday at 10:00 AM (system timezone)"
    );
    console.log("   Set TZ=America/Los_Angeles for Pacific Time\n");

    cron.schedule("0 10 * * 1", () => {
      runWorkflow().catch(console.error);
    });

    console.log("   Waiting for next scheduled run...");
    return; // Keep the process alive (node-cron handles the rest)
  }

  // ── --dry-run: Test without sending email ────────────────
  if (args.includes("--dry-run")) {
    await runWorkflow({ dryRun: true });
    process.exit(0);
  }

  // ── Default: Run once and send email ─────────────────────
  await runWorkflow();
  process.exit(0);
})().catch((err) => {
  console.error("\n💥 Fatal error:", err.message || err);
  console.error(err.stack);
  process.exit(1);
});
