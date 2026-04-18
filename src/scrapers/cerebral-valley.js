// ============================================================
// cerebral-valley.js — Scrapes events from Cerebral Valley
// ============================================================
//
// Cerebral Valley (cerebralvalley.ai) is a community that hosts
// AI-focused events in the Bay Area. Their events page uses
// JavaScript to render content, so we need a real browser
// (Playwright + Chromium) to load the page and extract text.
// ============================================================

const { SCRAPER_URLS, SCRAPER_TIMEOUT_MS } = require("../config");
const { sleep, withBrowserRetry } = require("./utils");

/**
 * Scrape events from Cerebral Valley.
 *
 * @returns {Promise<{source: string, raw: string, error?: string}>}
 */
async function scrapeCerebralValley() {
  console.log("🌐 Scraping Cerebral Valley...");

  return withBrowserRetry(
    "Cerebral Valley",
    async (browser) => {
      const page = await browser.newPage();
      try {
        await page.goto(SCRAPER_URLS.cerebralValley, {
          waitUntil: "networkidle",
          timeout: SCRAPER_TIMEOUT_MS,
        });
        await sleep(3000);

        const content = await page.evaluate(() => document.body.innerText);
        console.log("✅ Cerebral Valley scraped (" + content.length + " chars)");
        return { source: "Cerebral Valley", raw: content };
      } finally {
        await page.close();
      }
    },
    (errMsg) => ({ source: "Cerebral Valley", raw: "", error: errMsg })
  );
}

module.exports = { scrapeCerebralValley };
