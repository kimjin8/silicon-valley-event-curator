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

module.exports = { sleep, withBrowserRetry, BROWSER_LAUNCH_OPTIONS, SCRAPER_TIMEOUT_MS };
