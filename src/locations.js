// ============================================================
// locations.js — Shared location heuristics
// ============================================================
//
// Used in two places:
//   - the Cerebral Valley scraper, to drop mislocated events at ingestion
//   - the validator, as a backstop on the AI's shortlist output
//
// Upstream location data is sometimes flat wrong (the CV API tagged an
// "AI Tinkerers - Columbus" meetup as "San Francisco, CA"). The event name
// and its registration host tell the truth in those cases, so we cross-check
// them against a list of well-known non-Bay-Area cities.
// ============================================================

// Cities that show up in event titles and city-chapter subdomains (AI
// Tinkerers runs columbus.aitinkerers.org, reykjavik.aitinkerers.org, …).
// Bay Area cities are deliberately absent.
const NON_BAY_AREA_CITIES = [
  "columbus", "reykjavik", "new york", "nyc", "brooklyn", "los angeles",
  "seattle", "austin", "denver", "boston", "chicago", "miami", "atlanta",
  "portland", "san diego", "nashville", "dallas", "houston", "philadelphia",
  "detroit", "minneapolis", "pittsburgh", "toronto", "vancouver", "montreal",
  "london", "paris", "berlin", "munich", "amsterdam", "dublin", "lisbon",
  "madrid", "barcelona", "zurich", "singapore", "tokyo", "seoul", "hong kong",
  "shanghai", "beijing", "bangalore", "bengaluru", "mumbai", "dubai",
  "tel aviv", "sydney", "melbourne", "sao paulo", "mexico city", "las vegas",
];

// Return the first non-Bay-Area city named in the event's title or its
// registration host, or null. Dots/hyphens in the host are flattened to spaces
// so "columbus.aitinkerers.org" exposes "columbus" as a whole word; the regex
// requires non-letter boundaries so "austin" won't match inside "exhausting".
function nonBayAreaCityHint(name, url) {
  let hostText = "";
  try {
    hostText = new URL(url).host.toLowerCase().replace(/[.-]/g, " ");
  } catch {}
  const hay = ` ${String(name || "").toLowerCase()} ${hostText} `;
  for (const city of NON_BAY_AREA_CITIES) {
    if (new RegExp(`[^a-z]${city.replace(/ /g, "[ ]")}[^a-z]`).test(hay)) {
      return city;
    }
  }
  return null;
}

module.exports = { NON_BAY_AREA_CITIES, nonBayAreaCityHint };
