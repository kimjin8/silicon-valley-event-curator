// ============================================================
// cerebral-valley.js — Scrapes events from Cerebral Valley
// ============================================================
//
// Cerebral Valley (cerebralvalley.ai) is a community that hosts
// AI-focused events in the Bay Area. Their events page uses
// JavaScript to render content, so we need a real browser
// (Playwright + Chromium) to load the page and extract text.
//
// This scraper:
//   1. Opens the Bay Area events page in a headless browser
//   2. Waits for the page to fully load (including JS rendering)
//   3. Extracts all visible text content
//   4. Returns the raw text for the AI to parse later
//
// Error handling: if the page fails to load, we retry up to
// SCRAPER_MAX_RETRIES times before returning empty data.
// A failed scraper does NOT crash the whole pipeline.
// ============================================================

const { chromium } = require("playwright");
const {
  SCRAPER_URLS,
  SCRAPER_TIMEOUT_MS,
  SCRAPER_MAX_RETRIES,
  SCRAPER_RETRY_DELAY_MS,
} = require("../config");

/**
 * Wait for a specified number of milliseconds.
 * Used for retry delays and page load waits.
 *
 * @param {number} ms - Milliseconds to wait
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scrape events from Cerebral Valley.
 *
 * @param {object} browserLaunchOptions - Options passed to chromium.launch()
 * @returns {Promise<{source: string, raw: string, error?: string}>}
 *   - source: "Cerebral Valley" (identifies where this data came from)
 *   - raw: The extracted text content (or empty string on failure)
 *   - error: Error message if the scrape failed
 */
async function scrapeCerebralValley(browserLaunchOptions) {
  console.log("🌐 Scraping Cerebral Valley...");

  // Retry loop: try up to (1 + SCRAPER_MAX_RETRIES) times
  for (let attempt = 0; attempt <= SCRAPER_MAX_RETRIES; attempt++) {
    // Log retry attempts (skip for the first try)
    if (attempt > 0) {
      console.log(
        `   ↻ Retry ${attempt}/${SCRAPER_MAX_RETRIES} after ${SCRAPER_RETRY_DELAY_MS / 1000}s...`
      );
      await sleep(SCRAPER_RETRY_DELAY_MS);
    }

    // Launch a fresh browser for each attempt
    const browser = await chromium.launch(browserLaunchOptions);

    try {
      const page = await browser.newPage();

      try {
        await page.goto(SCRAPER_URLS.cerebralValley, {
          waitUntil: "networkidle",
          timeout: SCRAPER_TIMEOUT_MS,
        });

        await sleep(3000);

        const content = await page.evaluate(() => document.body.innerText);

        console.log(
          "✅ Cerebral Valley scraped (" + content.length + " chars)"
        );
        return { source: "Cerebral Valley", raw: content };
      } catch (err) {
        console.error(
          `❌ Cerebral Valley scrape failed (attempt ${attempt + 1}):`,
          err.message
        );

        if (attempt === SCRAPER_MAX_RETRIES) {
          return { source: "Cerebral Valley", raw: "", error: err.message };
        }
      } finally {
        await page.close();
      }
    } finally {
      // ALWAYS close the browser to free resources
      await browser.close();
    }
  }
}

module.exports = { scrapeCerebralValley };
