// ============================================================
// cerebral-valley.js — Scrapes events from Cerebral Valley
// ============================================================
//
// Cerebral Valley (cerebralvalley.ai) is a community that hosts
// AI-focused events in the Bay Area.
//
// PRIMARY: Fetches structured events from their public JSON API.
// FALLBACK: Browser-based scraping if the API is unavailable.
// ============================================================

const { SCRAPER_URLS, SCRAPER_TIMEOUT_MS } = require("../config");
const { sleep, withRetry, withBrowserRetry, scrollToLoadAll, toPacificTime, formatTimeRange } = require("./utils");
const { nonBayAreaCityHint } = require("../locations");

const CV_API_BASE = "https://api.cerebralvalley.ai/v1/public/event/pull";

// Locations considered "Bay Area" for filtering API results
const BAY_AREA_PATTERNS = [
  "san francisco", "sf,", "oakland", "berkeley", "palo alto",
  "mountain view", "sunnyvale", "san jose", "menlo park",
  "redwood city", "santa clara", "cupertino", "san mateo",
  "fremont", "milpitas", "stanford", "south san francisco",
  ", ca",
];

function isBayArea(location) {
  if (!location) return false;
  const lower = location.toLowerCase();
  return BAY_AREA_PATTERNS.some((p) => lower.includes(p));
}

// Keep an event only if its location looks Bay Area AND neither its name nor
// its registration host names a non-Bay-Area city. The second check catches
// upstream mislabeling — the CV API returns "AI Tinkerers - Columbus" (host
// columbus.aitinkerers.org) with location "San Francisco, CA".
function isAttendableBayAreaEvent(e) {
  return isBayArea(e.location) && !nonBayAreaCityHint(e.name, e.url);
}

/**
 * Fetch events from the Cerebral Valley public API.
 * Returns structured event data filtered to Bay Area.
 */
async function fetchFromAPI() {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const startDT = now.toISOString();
  const endDT = weekFromNow.toISOString();

  // Fetch all events in the date range (paginate if needed)
  const allEvents = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${CV_API_BASE}?approved=true&startDateTime=${encodeURIComponent(startDT)}&endDateTime=${encodeURIComponent(endDT)}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CV API returned ${res.status}`);

    const data = await res.json();
    const events = data.events || [];
    allEvents.push(...events);

    if (events.length < limit || allEvents.length >= data.totalCount) break;
    offset += limit;
  }

  // Filter to Bay Area and deduplicate by name+date
  const seen = new Set();
  const bayAreaEvents = allEvents.filter((e) => {
    if (!isAttendableBayAreaEvent(e)) return false;
    const key = `${e.name}|${e.startDateTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Normalize to a consistent shape with pre-computed PT times
  // CV API returns timestamps without timezone suffix (e.g., "2026-04-18 23:00:00")
  // which JS interprets as local time. Add Z to treat as UTC.
  const toUTC = (dt) => dt ? dt.replace(" ", "T").replace(/([^Z])$/, "$1Z") : null;

  const events = bayAreaEvents.map((e) => {
    const start = toPacificTime(toUTC(e.startDateTime));
    const end = toPacificTime(toUTC(e.endDateTime));
    return {
      name: e.name,
      date: toUTC(e.startDateTime),
      endDate: toUTC(e.endDateTime),
      dayOfWeek: start.dayOfWeek,
      datePT: start.datePT,
      startTimePT: start.timePT,
      endTimePT: end.timePT,
      displayTime: formatTimeRange(toUTC(e.startDateTime), toUTC(e.endDateTime)),
      location: e.location,
      venue: e.venue || null,
      url: e.url || null,
      description: (e.descriptionSummary || e.description || "").substring(0, 300),
      source: "Cerebral Valley",
    };
  });

  // Build a text summary for the AI using PT times
  const raw = events
    .map((e) => `${e.name}\n${e.dayOfWeek} ${e.datePT}, ${e.displayTime} | ${e.location}\n${e.description}`)
    .join("\n\n");

  return { events, raw };
}

/**
 * Scrape events from Cerebral Valley.
 * Tries the public API first, falls back to browser scraping.
 *
 * @returns {Promise<{source: string, raw: string, events?: Array, error?: string}>}
 */
async function scrapeCerebralValley() {
  console.log("🌐 Scraping Cerebral Valley...");

  // Try API first
  const apiResult = await withRetry(
    "Cerebral Valley API",
    async () => {
      const { events, raw } = await fetchFromAPI();
      console.log(`✅ Cerebral Valley API: ${events.length} Bay Area events`);
      return { source: "Cerebral Valley", raw, events };
    },
    () => null // Return null on failure so we try the browser fallback
  );

  if (apiResult) return apiResult;

  // Fallback: browser scraping
  console.log("   ⚠ API failed, falling back to browser scraping...");
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
        await scrollToLoadAll(page);

        const content = await page.evaluate(() => document.body.innerText);
        console.log("✅ Cerebral Valley scraped via browser (" + content.length + " chars)");
        return { source: "Cerebral Valley", raw: content };
      } finally {
        await page.close();
      }
    },
    (errMsg) => ({ source: "Cerebral Valley", raw: "", error: errMsg })
  );
}

module.exports = { scrapeCerebralValley, isBayArea, isAttendableBayAreaEvent };
