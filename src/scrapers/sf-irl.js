// ============================================================
// sf-irl.js — Scrapes events from the SF IRL Newsletter
// ============================================================
//
// SF IRL (https://sfirl.beehiiv.com/) is a curated newsletter
// about tech and startup events in San Francisco.
//
// TWO-PASS SCRAPING:
//   Pass 1 — Index Page: find the most recent article link
//   Pass 2 — Article Page: extract the full article text
// ============================================================

const { SCRAPER_URLS, SCRAPER_TIMEOUT_MS } = require("../config");
const { sleep, withBrowserRetry } = require("./utils");

/**
 * Find the latest article URL from the SF IRL index page.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>} The article URL, or null if not found
 */
async function findLatestArticleUrl(page) {
  await page.goto(SCRAPER_URLS.sfIrlIndex, {
    waitUntil: "networkidle",
    timeout: SCRAPER_TIMEOUT_MS,
  });
  await sleep(2000);

  // Try primary selector: links with /p/ path
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href*="/p/"]'))
      .map((a) => a.href)
      .filter((href) => href.includes("sfirl.beehiiv.com/p/"));
  });

  if (links.length > 0) return links[0];

  // Fallback: broader search for beehiiv article links
  const allLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a"))
      .map((a) => ({ href: a.href, text: a.textContent.trim() }))
      .filter((l) => l.href.includes("beehiiv.com/p/"))
  );

  return allLinks.length > 0 ? allLinks[0].href : null;
}

/**
 * Scrape the latest SF IRL newsletter for event listings.
 *
 * @returns {Promise<{source: string, raw: string, articleUrl?: string, error?: string}>}
 */
async function scrapeSFIRL() {
  console.log("🌐 Scraping SF IRL Newsletter...");

  return withBrowserRetry(
    "SF IRL",
    async (browser) => {
      // Pass 1: Find the latest article URL
      const indexPage = await browser.newPage();
      let latestArticleUrl;
      try {
        latestArticleUrl = await findLatestArticleUrl(indexPage);
      } finally {
        await indexPage.close();
      }

      if (!latestArticleUrl) {
        throw new Error("Could not find latest article URL");
      }

      console.log("   📰 Found latest article:", latestArticleUrl);

      // Pass 2: Scrape the actual article
      const articlePage = await browser.newPage();
      try {
        await articlePage.goto(latestArticleUrl, {
          waitUntil: "networkidle",
          timeout: SCRAPER_TIMEOUT_MS,
        });
        await sleep(2000);

        const content = await articlePage.evaluate(() => document.body.innerText);
        console.log("✅ SF IRL scraped (" + content.length + " chars)");

        return { source: "SF IRL", raw: content, articleUrl: latestArticleUrl };
      } finally {
        await articlePage.close();
      }
    },
    (errMsg) => ({ source: "SF IRL", raw: "", error: errMsg })
  );
}

module.exports = { scrapeSFIRL };
