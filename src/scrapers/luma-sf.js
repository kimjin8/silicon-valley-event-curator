// ============================================================
// luma-sf.js — Scrapes events from Luma SF
// ============================================================
//
// Luma (lu.ma) is a popular event platform. Their SF page shows
// upcoming events in San Francisco and the Bay Area.
//
// IMPORTANT: This scraper extracts individual event links, not
// just text. Each event on Luma has its own page (e.g.,
// lu.ma/ai-iceberg-meetup) where you can register. We need
// these specific URLs so the email's "Register" buttons link
// directly to the event registration page — NOT to the generic
// lu.ma/sf listing page.
//
// How we extract event links:
//   - Luma renders event cards as clickable elements with <a> tags
//   - Each card's href points to the individual event page
//   - We extract both the event text AND the link for each card
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
 * @param {number} ms - Milliseconds to wait
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scrape events from Luma SF, including individual event links.
 *
 * @param {object} browserLaunchOptions - Options passed to chromium.launch()
 * @returns {Promise<{source: string, raw: string, events?: Array, error?: string}>}
 *   - source: "Luma SF"
 *   - raw: Full page text content
 *   - events: Array of extracted event objects with name, link, details
 *   - error: Error message if the scrape failed
 */
async function scrapeLumaSF(browserLaunchOptions) {
  console.log("🌐 Scraping Luma SF...");

  for (let attempt = 0; attempt <= SCRAPER_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(
        `   ↻ Retry ${attempt}/${SCRAPER_MAX_RETRIES} after ${SCRAPER_RETRY_DELAY_MS / 1000}s...`
      );
      await sleep(SCRAPER_RETRY_DELAY_MS);
    }

    const browser = await chromium.launch(browserLaunchOptions);

    try {
      const page = await browser.newPage();

      try {
        await page.goto(SCRAPER_URLS.lumaSF, {
          waitUntil: "networkidle",
          timeout: SCRAPER_TIMEOUT_MS,
        });

        await sleep(3000);

        const events = await page.evaluate(() => {
          const results = [];
          const eventLinks = document.querySelectorAll("a.event-link");

          for (const link of eventLinks) {
            const href = link.href;
            if (
              !href ||
              href === "https://lu.ma/sf" ||
              href === "https://lu.ma/sf/" ||
              href.endsWith("/sf") ||
              href.endsWith("/sf/")
            ) {
              continue;
            }

            const ariaLabel = link.getAttribute("aria-label");
            const innerTextFirstLine = link.innerText.trim().split("\n")[0];
            const name = ariaLabel || innerTextFirstLine || "Unknown Event";
            const details = link.innerText.trim();

            if (name && name.length > 2) {
              results.push({ name, link: href, details });
            }
          }

          return results;
        });

        const content = await page.evaluate(() => document.body.innerText);

        console.log(
          `✅ Luma SF scraped (${content.length} chars, ${events.length} event links found)`
        );

        const validEvents = events.filter(
          (e) =>
            e.link !== "https://lu.ma/sf" &&
            e.link !== "https://lu.ma/sf/" &&
            !e.link.endsWith("/sf") &&
            !e.link.endsWith("/sf/")
        );
        if (validEvents.length !== events.length) {
          console.warn(
            `   ⚠ Filtered out ${events.length - validEvents.length} links pointing to listing page`
          );
        }

        return {
          source: "Luma SF",
          raw: content,
          events: validEvents,
        };
      } catch (err) {
        console.error(
          `❌ Luma SF scrape failed (attempt ${attempt + 1}):`,
          err.message
        );

        if (attempt === SCRAPER_MAX_RETRIES) {
          return { source: "Luma SF", raw: "", events: [], error: err.message };
        }
      } finally {
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
}

module.exports = { scrapeLumaSF };
