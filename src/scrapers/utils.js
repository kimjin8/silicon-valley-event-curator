// ============================================================
// utils.js — Shared scraper utilities
// ============================================================

const { chromium } = require("playwright");
const {
  SCRAPER_TIMEOUT_MS,
  SCRAPER_MAX_RETRIES,
  SCRAPER_RETRY_DELAY_MS,
} = require("../config");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an async function with retry logic (no browser).
 * Used by API-based scrapers.
 *
 * @param {string} sourceName - Name of the source (for logging)
 * @param {function} fn - async () => result. Throw to trigger retry.
 * @param {function} emptyResult - (errMsg) => fallback result on final failure
 * @returns {Promise<object>}
 */
async function withRetry(sourceName, fn, emptyResult) {
  for (let attempt = 0; attempt <= SCRAPER_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(
        `   ↻ Retry ${attempt}/${SCRAPER_MAX_RETRIES} after ${SCRAPER_RETRY_DELAY_MS / 1000}s...`
      );
      await sleep(SCRAPER_RETRY_DELAY_MS);
    }
    try {
      return await fn();
    } catch (err) {
      console.error(
        `❌ ${sourceName} failed (attempt ${attempt + 1}):`,
        err.message
      );
      if (attempt === SCRAPER_MAX_RETRIES) {
        return emptyResult(err.message);
      }
    }
  }
}

/**
 * Browser launch options for headless Chromium.
 * Used by all scrapers to launch a consistent browser instance.
 */
const BROWSER_LAUNCH_OPTIONS = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ],
};

/**
 * Run a scraper function with retry logic and browser lifecycle management.
 *
 * Each attempt launches a fresh browser, passes it to the callback,
 * and ensures the browser is always closed afterward.
 *
 * @param {string} sourceName - Name of the source (for logging)
 * @param {function} scrapeFn - async (browser) => result. Should return
 *   the successful result object, or throw to trigger a retry.
 * @param {function} emptyResult - () => the error result shape for this scraper
 * @returns {Promise<object>} The scraper result
 */
async function withBrowserRetry(sourceName, scrapeFn, emptyResult) {
  for (let attempt = 0; attempt <= SCRAPER_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(
        `   ↻ Retry ${attempt}/${SCRAPER_MAX_RETRIES} after ${SCRAPER_RETRY_DELAY_MS / 1000}s...`
      );
      await sleep(SCRAPER_RETRY_DELAY_MS);
    }

    const browser = await chromium.launch(BROWSER_LAUNCH_OPTIONS);
    try {
      return await scrapeFn(browser);
    } catch (err) {
      console.error(
        `❌ ${sourceName} scrape failed (attempt ${attempt + 1}):`,
        err.message
      );
      if (attempt === SCRAPER_MAX_RETRIES) {
        return emptyResult(err.message);
      }
    } finally {
      await browser.close();
    }
  }
}

/**
 * Scroll to the bottom of a page repeatedly to trigger lazy-loading.
 * Stops when no new content loads or maxScrolls is reached.
 *
 * @param {import('playwright').Page} page
 * @param {object} options
 * @param {number} options.maxScrolls - Maximum scroll attempts (default 5)
 * @param {number} options.delayMs - Wait between scrolls for content to load (default 2000)
 */
async function scrollToLoadAll(page, { maxScrolls = 5, delayMs = 2000 } = {}) {
  let previousHeight = 0;
  for (let i = 0; i < maxScrolls; i++) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === previousHeight) break;
    previousHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(delayMs);
  }
}

/**
 * Convert an ISO timestamp to Pacific Time components.
 * Pre-computes day-of-week and formatted time so the AI doesn't
 * have to do timezone math (which it gets wrong).
 *
 * @param {string} isoString - ISO 8601 timestamp (e.g. from API)
 * @returns {{ dayOfWeek: string, datePT: string, timePT: string }}
 */
function toPacificTime(isoString) {
  if (!isoString) return { dayOfWeek: "", datePT: "", timePT: "" };
  const d = new Date(isoString);
  const tz = "America/Los_Angeles";
  return {
    dayOfWeek: d.toLocaleDateString("en-US", { weekday: "long", timeZone: tz }),
    datePT: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz }),
    timePT: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }),
  };
}

/**
 * Format a start/end time range for display, handling cross-day spans.
 * Same-day:  "7:00 PM – 9:30 PM"
 * Multi-day: "Fri 7:00 PM – Sat 3:00 PM"
 *
 * Prevents the "Scrappy Founders 7:00 PM – 3:00 PM" overnight bug where
 * the formatted string is ambiguous about which day each time refers to.
 */
function formatTimeRange(startISO, endISO) {
  const s = toPacificTime(startISO);
  const e = toPacificTime(endISO);
  if (!s.timePT && !e.timePT) return "";
  if (!e.timePT) return s.timePT;
  if (s.dayOfWeek === e.dayOfWeek && s.datePT === e.datePT) {
    return `${s.timePT} – ${e.timePT}`;
  }
  const sShort = s.dayOfWeek.slice(0, 3);
  const eShort = e.dayOfWeek.slice(0, 3);
  return `${sShort} ${s.timePT} – ${eShort} ${e.timePT}`;
}

module.exports = { sleep, withRetry, withBrowserRetry, scrollToLoadAll, toPacificTime, formatTimeRange, BROWSER_LAUNCH_OPTIONS, SCRAPER_TIMEOUT_MS };
