// ============================================================
// luma-sf.js — Scrapes events from Luma SF
// ============================================================
//
// Luma (lu.ma) is a popular event platform. This scraper extracts
// individual event links (not just text) so the email's "Register"
// buttons link directly to event registration pages — NOT to the
// generic lu.ma/sf listing page.
// ============================================================

const { SCRAPER_URLS, SCRAPER_TIMEOUT_MS } = require("../config");
const { sleep, withBrowserRetry } = require("./utils");

/**
 * Check if a URL is the Luma SF listing page (not an individual event).
 */
function isListingPageUrl(href) {
  return (
    href === "https://lu.ma/sf" ||
    href === "https://lu.ma/sf/" ||
    href.endsWith("/sf") ||
    href.endsWith("/sf/")
  );
}

/**
 * Scrape events from Luma SF, including individual event links.
 *
 * @returns {Promise<{source: string, raw: string, events?: Array, error?: string}>}
 */
async function scrapeLumaSF() {
  console.log("🌐 Scraping Luma SF...");

  return withBrowserRetry(
    "Luma SF",
    async (browser) => {
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

        // Filter out any listing-page URLs that slipped through
        const validEvents = events.filter((e) => !isListingPageUrl(e.link));
        if (validEvents.length !== events.length) {
          console.warn(
            `   ⚠ Filtered out ${events.length - validEvents.length} links pointing to listing page`
          );
        }

        console.log(
          `✅ Luma SF scraped (${content.length} chars, ${validEvents.length} event links found)`
        );

        return { source: "Luma SF", raw: content, events: validEvents };
      } finally {
        await page.close();
      }
    },
    (errMsg) => ({ source: "Luma SF", raw: "", events: [], error: errMsg })
  );
}

module.exports = { scrapeLumaSF, isListingPageUrl };
