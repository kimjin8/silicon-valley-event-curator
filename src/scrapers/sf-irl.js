// ============================================================
// sf-irl.js — Scrapes events from the SF IRL Newsletter
// ============================================================
//
// SF IRL (https://sfirl.beehiiv.com/) is a curated newsletter
// about tech and startup events in San Francisco, written by
// Jonathan Chang. It's published weekly.
//
// TWO-PASS SCRAPING:
// Unlike the other sources, SF IRL requires two page loads:
//
//   Pass 1 — Index Page (sfirl.beehiiv.com):
//     The home page shows an "Archive" grid of newsletter articles.
//     Each article card has a title like "SF IRL – Mar 23rd, 2026"
//     and a link like sfirl.beehiiv.com/p/<article-slug>.
//     We find the most recent article's link.
//
//   Pass 2 — Article Page (sfirl.beehiiv.com/p/<slug>):
//     The actual newsletter content with event listings.
//     We extract the full article text for the AI to parse.
//
// WHY TWO PASSES?
// The home page doesn't contain the actual event details — it's
// just an index. You have to click into an article to read the
// events. We automate what you'd do manually: browse the archive,
// click the latest issue, read it.
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
 * Scrape the latest SF IRL newsletter for event listings.
 *
 * @param {object} browserLaunchOptions - Options passed to chromium.launch()
 * @returns {Promise<{source: string, raw: string, articleUrl?: string, error?: string}>}
 *   - source: "SF IRL"
 *   - raw: Full article text content
 *   - articleUrl: URL of the article we scraped
 *   - error: Error message if the scrape failed
 */
async function scrapeSFIRL(browserLaunchOptions) {
  console.log("🌐 Scraping SF IRL Newsletter...");

  for (let attempt = 0; attempt <= SCRAPER_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(
        `   ↻ Retry ${attempt}/${SCRAPER_MAX_RETRIES} after ${SCRAPER_RETRY_DELAY_MS / 1000}s...`
      );
      await sleep(SCRAPER_RETRY_DELAY_MS);
    }

    // Launch a fresh browser for this attempt
    const browser = await chromium.launch(browserLaunchOptions);

    try {
      // ── Pass 1: Find the latest article URL ──────────────────
      let latestArticleUrl = null;
      const indexPage = await browser.newPage();

      try {
        await indexPage.goto(SCRAPER_URLS.sfIrlIndex, {
          waitUntil: "networkidle",
          timeout: SCRAPER_TIMEOUT_MS,
        });

        await sleep(2000);

        const links = await indexPage.evaluate(() => {
          const articleAnchors = Array.from(
            document.querySelectorAll('a[href*="/p/"]')
          );
          return articleAnchors
            .map((a) => a.href)
            .filter((href) => href.includes("sfirl.beehiiv.com/p/"));
        });

        if (links.length > 0) {
          latestArticleUrl = links[0];
          console.log("   📰 Found latest article:", latestArticleUrl);
        } else {
          const allLinks = await indexPage.evaluate(() =>
            Array.from(document.querySelectorAll("a"))
              .map((a) => ({ href: a.href, text: a.textContent.trim() }))
              .filter((l) => l.href.includes("beehiiv.com/p/"))
          );

          if (allLinks.length > 0) {
            latestArticleUrl = allLinks[0].href;
            console.log("   📰 Found article (fallback):", latestArticleUrl);
          }
        }
      } catch (err) {
        console.error("   ❌ Failed to load SF IRL index:", err.message);
      } finally {
        await indexPage.close();
      }

      // If we couldn't find any article link, try again
      if (!latestArticleUrl) {
        console.error("   ❌ Could not find latest SF IRL article URL");
        if (attempt === SCRAPER_MAX_RETRIES) {
          return {
            source: "SF IRL",
            raw: "",
            error: "Could not find latest article URL after all retries",
          };
        }
        continue; // Try again
      }

      // ── Pass 2: Scrape the actual article ────────────────────
      const articlePage = await browser.newPage();

      try {
        await articlePage.goto(latestArticleUrl, {
          waitUntil: "networkidle",
          timeout: SCRAPER_TIMEOUT_MS,
        });

        await sleep(2000);

        const content = await articlePage.evaluate(() => document.body.innerText);

        console.log("✅ SF IRL scraped (" + content.length + " chars)");
        return {
          source: "SF IRL",
          raw: content,
          articleUrl: latestArticleUrl,
        };
      } catch (err) {
        console.error("   ❌ Failed to scrape SF IRL article:", err.message);
        if (attempt === SCRAPER_MAX_RETRIES) {
          return { source: "SF IRL", raw: "", error: err.message };
        }
      } finally {
        await articlePage.close();
      }
    } finally {
      // ALWAYS close the browser to free resources
      await browser.close();
    }
  }
}

module.exports = { scrapeSFIRL };
