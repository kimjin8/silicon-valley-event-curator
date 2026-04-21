// ============================================================
// luma-sf.js — Scrapes events from Luma SF
// ============================================================
//
// Luma (lu.ma) is a popular event platform. This scraper extracts
// individual event links so the email's "Register" buttons link
// directly to event registration pages.
//
// PRIMARY: Fetches structured events from Luma's public API.
// FALLBACK: Browser-based scraping if the API is unavailable.
// ============================================================

const { SCRAPER_URLS, SCRAPER_TIMEOUT_MS } = require("../config");
const { sleep, withRetry, withBrowserRetry, scrollToLoadAll, toPacificTime } = require("./utils");

const LUMA_API_BASE = "https://api2.luma.com/discover/get-paginated-events";
const LUMA_SF_PLACE_ID = "discplace-BDj7GNbGlsF7Cka";

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
 * Fetch events from the Luma public API.
 * Paginates until we pass the 8-day window.
 */
async function fetchFromAPI() {
  const cutoff = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  const allEntries = [];
  let cursor = null;

  while (true) {
    let url = `${LUMA_API_BASE}?discover_place_api_id=${LUMA_SF_PLACE_ID}&pagination_limit=50`;
    if (cursor) url += `&pagination_cursor=${encodeURIComponent(cursor)}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Luma API returned ${res.status}`);

    const data = await res.json();
    const entries = data.entries || [];
    allEntries.push(...entries);

    // Stop if no more pages or we've passed the date window
    if (!data.has_more || entries.length === 0) break;

    const lastDate = new Date(entries[entries.length - 1].start_at);
    if (lastDate > cutoff) break;

    cursor = data.next_cursor;
  }

  // Filter to events within the next 8 days
  const now = new Date();
  const relevantEntries = allEntries.filter((e) => {
    const start = new Date(e.start_at);
    return start >= now && start <= cutoff;
  });

  // Normalize to a consistent shape with pre-computed PT times
  const events = relevantEntries.map((e) => {
    const evt = e.event;
    const addr = evt.geo_address_info || {};
    const ticket = e.ticket_info || {};
    const start = toPacificTime(e.start_at);
    const end = toPacificTime(evt.end_at);

    return {
      name: evt.name,
      link: `https://lu.ma/${evt.url}`,
      date: e.start_at,
      endDate: evt.end_at,
      dayOfWeek: start.dayOfWeek,
      datePT: start.datePT,
      startTimePT: start.timePT,
      endTimePT: end.timePT,
      location: addr.full_address || addr.short_address || addr.city || null,
      city: addr.city || null,
      isFree: ticket.is_free || false,
      price: ticket.price ? `$${ticket.price.cents / 100}` : null,
      isSoldOut: ticket.is_sold_out || false,
      hosts: (e.hosts || []).map((h) => h.name).join(", "),
      details: evt.description || "",
      source: "Luma SF",
    };
  });

  // Build a text summary for the AI using PT times
  const raw = events
    .map((e) => `${e.name}\n${e.dayOfWeek} ${e.datePT}, ${e.startTimePT} – ${e.endTimePT} | ${e.location || e.city}\n${e.isFree ? "Free" : e.price || ""}`)
    .join("\n\n");

  return { events, raw };
}

/**
 * Scrape events from Luma SF.
 * Tries the public API first, falls back to browser scraping.
 *
 * @returns {Promise<{source: string, raw: string, events?: Array, error?: string}>}
 */
async function scrapeLumaSF() {
  console.log("🌐 Scraping Luma SF...");

  // Try API first
  const apiResult = await withRetry(
    "Luma SF API",
    async () => {
      const { events, raw } = await fetchFromAPI();
      console.log(`✅ Luma SF API: ${events.length} events in date range`);
      return { source: "Luma SF", raw, events };
    },
    () => null
  );

  if (apiResult) return apiResult;

  // Fallback: browser scraping
  console.log("   ⚠ API failed, falling back to browser scraping...");
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
        await scrollToLoadAll(page);

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

        const validEvents = events.filter((e) => !isListingPageUrl(e.link));
        console.log(
          `✅ Luma SF scraped via browser (${content.length} chars, ${validEvents.length} event links)`
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
