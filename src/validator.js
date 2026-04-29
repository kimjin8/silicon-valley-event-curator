// ============================================================
// validator.js — Sanity checks on Gemini's curated HTML output
// ============================================================
//
// Gemini can return HTML that parses cleanly (finishReason: STOP)
// but contains hallucinated URLs, drops legitimate events, or
// shortlists events that violate user rules (blocked evenings,
// calendar conflicts). These deterministic checks catch failure
// modes we've seen in production so the curator can advance to
// the next model instead of emailing garbage.
//
// The checks are intentionally coarse — they're a floor, not a
// filter. The AI stays in charge of judgment; we only reject
// outputs that violate factual invariants the user has set.
// ============================================================

const userConfig = require("../user-config");

// ── URL normalization shared across checks ──────────────────

function normalizeUrl(u) {
  if (!u) return "";
  return u
    .replace(/^http:\/\//, "https://")
    .replace(/^https:\/\/www\./, "https://")
    .replace(/\/+$/, "");
}

function urlSlug(u) {
  try {
    const segs = new URL(u).pathname.split("/").filter(Boolean);
    return segs[segs.length - 1] || "";
  } catch {
    return "";
  }
}

/**
 * Extract all event-link URLs that appear in input scraper data.
 * We collect: Luma event.link, CV event.url, and any URL from SF IRL raw text.
 */
function collectInputUrls(mergedData) {
  const urls = new Set();

  const lumaEvents = mergedData?.lumaSFEvents?.events || [];
  lumaEvents.forEach((e) => {
    if (e.link) urls.add(e.link);
  });

  const cvEvents = mergedData?.cerebralValleyEvents?.events || [];
  cvEvents.forEach((e) => {
    if (e.url) urls.add(e.url);
  });

  const sfIrlArticleUrl = mergedData?.sfIrlEvents?.articleUrl;
  if (sfIrlArticleUrl) urls.add(sfIrlArticleUrl);

  const sfIrlRaw = mergedData?.sfIrlEvents?.raw || "";
  for (const match of sfIrlRaw.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    urls.add(match[0]);
  }

  return urls;
}

/**
 * Build a lookup from normalized URL → event object so we can
 * reverse-resolve a URL in the AI's HTML back to the source event
 * (with its pre-computed dayOfWeek/startTimePT/endTimePT/date/endDate).
 */
function buildEventIndex(mergedData) {
  const idx = new Map();
  const luma = mergedData?.lumaSFEvents?.events || [];
  luma.forEach((e) => {
    if (e.link) idx.set(normalizeUrl(e.link), e);
  });
  const cv = mergedData?.cerebralValleyEvents?.events || [];
  cv.forEach((e) => {
    if (e.url) idx.set(normalizeUrl(e.url), e);
  });
  return idx;
}

function findEventForUrl(url, eventIndex) {
  const n = normalizeUrl(url);
  if (eventIndex.has(n)) return eventIndex.get(n);
  const slug = urlSlug(url);
  if (slug && slug.length >= 4) {
    for (const [key, event] of eventIndex) {
      if (key.includes(slug)) return event;
    }
  }
  return null;
}

/**
 * Does `outputUrl` correspond to any URL that was in the input?
 *
 * Tolerances:
 * - lu.ma and luma.com are the same platform
 * - trailing slashes, http vs https, www. prefix: normalized away
 * - if the output URL's final path segment (slug) appears in any input
 *   URL, it's considered a match — this catches Luma short-links
 */
function urlInInput(outputUrl, inputUrls) {
  if (!outputUrl) return true;

  const normalizedOutput = normalizeUrl(outputUrl);
  for (const u of inputUrls) {
    if (normalizeUrl(u) === normalizedOutput) return true;
  }

  let outHost;
  let outSlug;
  try {
    const parsed = new URL(outputUrl);
    outHost = parsed.host.replace(/^www\./, "");
    outSlug = urlSlug(outputUrl);
  } catch {
    return false;
  }

  const lumaHosts = new Set(["lu.ma", "luma.com"]);

  if (outSlug && outSlug.length >= 4) {
    for (const u of inputUrls) {
      if (u.includes(outSlug)) return true;
    }
  }

  if (lumaHosts.has(outHost)) {
    for (const u of inputUrls) {
      try {
        const uHost = new URL(u).host.replace(/^www\./, "");
        if (lumaHosts.has(uHost)) {
          const uSlug = urlSlug(u);
          if (uSlug && outSlug && uSlug === outSlug) return true;
        }
      } catch {}
    }
  }

  return false;
}

/**
 * Extract external hrefs from the shortlist + radar sections of the output HTML.
 * Skips utility links (mailto:, tel:, #anchors).
 */
function extractOutputUrls(html) {
  const sectionStart = html.search(/SHORTLISTED FOR YOU/i);
  const section = sectionStart >= 0 ? html.slice(sectionStart) : html;
  const urls = [];
  for (const m of section.matchAll(/href="([^"]+)"/gi)) {
    const h = m[1];
    if (/^https?:\/\//i.test(h)) urls.push(h);
  }
  return urls;
}

/**
 * Extract hrefs from the shortlist section ONLY (not radar).
 * Used to enforce shortlist-specific rules: blocked evenings, calendar conflicts.
 * Radar items are informational and not subject to these rules.
 */
function extractShortlistUrls(html) {
  const start = html.search(/SHORTLISTED FOR YOU/i);
  if (start < 0) return [];
  const radarStart = html.search(/ALSO ON YOUR RADAR/i);
  const section =
    radarStart > start ? html.slice(start, radarStart) : html.slice(start);
  const urls = [];
  for (const m of section.matchAll(/href="([^"]+)"/gi)) {
    if (/^https?:\/\//i.test(m[1])) urls.push(m[1]);
  }
  return [...new Set(urls)];
}

/**
 * Parse a "5:30 PM" style PT time string into a 24h hour integer.
 * Returns null if unparseable.
 */
function parsePTHour(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mer = m[3].toUpperCase();
  if (mer === "PM" && h !== 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  return h;
}

/**
 * Find shortlisted events that fall on a blockedEvenings day with
 * an evening start time (≥ 4pm PT). Returns an array of human-readable
 * violation strings.
 */
function checkBlockedEvenings(shortlistUrls, eventIndex) {
  const blocked = new Set(
    (userConfig.schedule?.blockedEvenings || []).map((s) => s.toLowerCase())
  );
  if (blocked.size === 0) return [];

  const violations = [];
  for (const url of shortlistUrls) {
    const e = findEventForUrl(url, eventIndex);
    if (!e) continue;
    const day = (e.dayOfWeek || "").toLowerCase();
    if (!blocked.has(day)) continue;
    const startHour = parsePTHour(e.startTimePT);
    if (startHour !== null && startHour >= 16) {
      violations.push(
        `"${e.name}" — ${e.dayOfWeek} ${e.startTimePT} (blocked evening)`
      );
    }
  }
  return violations;
}

/**
 * Find shortlisted events whose [date, endDate] overlaps any busy
 * calendar event's [start, end]. Returns an array of human-readable
 * violation strings.
 */
function checkCalendarConflicts(shortlistUrls, eventIndex, busyEvents) {
  if (!busyEvents || busyEvents.length === 0) return [];

  const calIntervals = [];
  for (const b of busyEvents) {
    const bs = b.start?.dateTime || b.start?.date;
    const be = b.end?.dateTime || b.end?.date;
    if (!bs || !be) continue;
    const start = new Date(bs).getTime();
    const end = new Date(be).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    calIntervals.push({ start, end, summary: b.summary || "(busy)" });
  }
  if (calIntervals.length === 0) return [];

  const violations = [];
  const seen = new Set();
  for (const url of shortlistUrls) {
    const e = findEventForUrl(url, eventIndex);
    if (!e || !e.date || !e.endDate) continue;
    const eStart = new Date(e.date).getTime();
    const eEnd = new Date(e.endDate).getTime();
    if (!Number.isFinite(eStart) || !Number.isFinite(eEnd)) continue;

    for (const c of calIntervals) {
      if (eStart < c.end && c.start < eEnd) {
        const key = `${e.name}|${c.summary}`;
        if (seen.has(key)) break;
        seen.add(key);
        violations.push(
          `"${e.name}" (${e.datePT} ${e.startTimePT}) overlaps calendar event "${c.summary}"`
        );
        break;
      }
    }
  }
  return violations;
}

// Allowlist of city/place tokens that count as "physically in the Bay Area".
// Used to catch upstream-bad-data leaks (e.g., the Reykjavik AI Tinkerer event).
// Lowercased; matched as substrings against the resolved event's location field.
const BAY_AREA_LOCATION_TOKENS = [
  "san francisco",
  "sf,",
  ", sf",
  "oakland",
  "berkeley",
  "palo alto",
  "mountain view",
  "sunnyvale",
  "san jose",
  "stanford",
  "menlo park",
  "redwood city",
  "san mateo",
  "cupertino",
  "santa clara",
  "fremont",
  "hayward",
  "millbrae",
  "burlingame",
  "south bay",
  "bay area",
  "emeryville",
  "alameda",
  "daly city",
  "south san francisco",
  "foster city",
  "los altos",
  "los gatos",
  "san bruno",
  "san carlos",
  "belmont",
  "pacifica",
  "richmond, ca",
  "san leandro",
  "campbell",
  "saratoga",
  "milpitas",
  "newark",
  "union city",
];

function isBayAreaLocation(loc) {
  if (!loc) return true; // unknown location: don't reject (online/TBD)
  const s = String(loc).toLowerCase();
  return BAY_AREA_LOCATION_TOKENS.some((tok) => s.includes(tok));
}

/**
 * Schema-level structural check on every shortlisted event card. Catches
 * surfaced events with non-Bay-Area locations (Reykjavik leak) and events
 * whose time strings encode an impossible same-day overnight range.
 *
 * Why this layer exists: each previous bug was a unique surface symptom
 * of "AI surfaced an event we shouldn't have shown the user" or "AI
 * formatted a field in a way no human would recognize". Listing every
 * possible symptom is endless; a small invariant set is finite.
 */
function checkSchemaInvariants(shortlistUrls, eventIndex) {
  const violations = [];
  for (const url of shortlistUrls) {
    const e = findEventForUrl(url, eventIndex);
    if (!e) continue;
    if (!isBayAreaLocation(e.location)) {
      violations.push(
        `"${e.name}" location "${e.location}" is outside the Bay Area`
      );
    }
    // Same-day overnight: if start and end fall on the same PT day but
    // end-hour < start-hour, the displayed range will be nonsensical.
    if (
      e.dayOfWeek &&
      e.startTimePT &&
      e.endTimePT &&
      e.date &&
      e.endDate
    ) {
      const sDay = new Date(e.date).toLocaleDateString("en-US", {
        timeZone: "America/Los_Angeles",
      });
      const eDay = new Date(e.endDate).toLocaleDateString("en-US", {
        timeZone: "America/Los_Angeles",
      });
      const sH = parsePTHour(e.startTimePT);
      const eH = parsePTHour(e.endTimePT);
      if (sDay === eDay && sH !== null && eH !== null && eH < sH) {
        violations.push(
          `"${e.name}" same-day time range is impossible: ${e.startTimePT} – ${e.endTimePT}`
        );
      }
    }
  }
  return violations;
}

/**
 * Validate the AI's curated HTML against the input data and user rules.
 *
 * Checks (any failure flips ok=false and triggers model fallback retry):
 *  1. URL fidelity — every output URL traces to an input event
 *  2. Coverage floor — with ≥10 scraped events, surface ≥3 total
 *  3. Blocked evenings — no shortlisted event on a blocked-evening day
 *  4. Calendar conflicts — no shortlisted event overlapping a busy event
 *
 * @param {string} html - Curator output HTML
 * @param {object} mergedData - The merged input that was sent to the AI
 * @returns {{ok: boolean, reasons: string[], stats: object}}
 */
function validateCurationOutput(html, mergedData) {
  const reasons = [];
  const inputUrls = collectInputUrls(mergedData);
  const eventIndex = buildEventIndex(mergedData);

  // 1. URL fidelity (across shortlist + radar)
  const outputUrls = extractOutputUrls(html);
  const uniqueOutputUrls = [...new Set(outputUrls)];
  const unknown = uniqueOutputUrls.filter((u) => !urlInInput(u, inputUrls));
  if (unknown.length > 0) {
    reasons.push(
      `${unknown.length} hallucinated URL(s): ${unknown.slice(0, 3).join(", ")}`
    );
  }

  // 2. Coverage floor
  const lumaCount = (mergedData?.lumaSFEvents?.events || []).length;
  const cvCount = (mergedData?.cerebralValleyEvents?.events || []).length;
  const inputEventCount = lumaCount + cvCount;

  const shortlistMatch = html.match(/SHORTLISTED FOR YOU \((\d+) EVENTS?\)/i);
  const shortlistCount = shortlistMatch ? parseInt(shortlistMatch[1], 10) : 0;

  const radarSection = html.split(/ALSO ON YOUR RADAR/i)[1] || "";
  const radarCount = (radarSection.match(/[A-Z]+DAY · [A-Z]+ \d+/g) || []).length;

  // Coverage floor: with ≥10 scraped events, surfacing 0 means the AI
  // dropped the ball entirely (the 10am 2026-04-20 incident). With the
  // pre-filter now stripping un-attendable events upstream, sparse weeks
  // can legitimately yield 1-2 matches — only 0 is unambiguously broken.
  const surfaced = shortlistCount + radarCount;
  if (inputEventCount >= 10 && surfaced === 0) {
    reasons.push(
      `Surfaced 0 events (${shortlistCount} shortlist + ${radarCount} radar) from ${inputEventCount} scraped events`
    );
  }

  // 3 & 4. Shortlist-specific rule checks
  const shortlistUrls = extractShortlistUrls(html);

  // 2b. Every shortlisted event card must have a real registration URL.
  // The AI sometimes drops in `href="#"` placeholders, producing un-clickable
  // Register buttons. shortlistCount comes from the "(N EVENTS)" header;
  // shortlistUrls.length is the count of real http(s) hrefs we found.
  if (shortlistCount > 0 && shortlistUrls.length < shortlistCount) {
    reasons.push(
      `Shortlist has ${shortlistCount} events but only ${shortlistUrls.length} valid registration URLs (some buttons are placeholder #)`
    );
  }

  const blockedEveningViolations = checkBlockedEvenings(
    shortlistUrls,
    eventIndex
  );
  if (blockedEveningViolations.length > 0) {
    reasons.push(
      `Blocked-evening violation(s): ${blockedEveningViolations.join("; ")}`
    );
  }

  const conflictViolations = checkCalendarConflicts(
    shortlistUrls,
    eventIndex,
    mergedData?.busyCalendarEvents
  );
  if (conflictViolations.length > 0) {
    reasons.push(`Calendar conflict(s): ${conflictViolations.join("; ")}`);
  }

  // 5. Schema invariants (location in Bay Area, sane time range)
  const schemaViolations = checkSchemaInvariants(shortlistUrls, eventIndex);
  if (schemaViolations.length > 0) {
    reasons.push(`Schema violation(s): ${schemaViolations.join("; ")}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    stats: {
      inputEventCount,
      outputUrlCount: uniqueOutputUrls.length,
      unknownUrlCount: unknown.length,
      shortlistCount,
      radarCount,
      shortlistUrlCount: shortlistUrls.length,
      blockedEveningViolationCount: blockedEveningViolations.length,
      conflictViolationCount: conflictViolations.length,
      schemaViolationCount: schemaViolations.length,
    },
  };
}

module.exports = {
  validateCurationOutput,
  urlInInput,
  collectInputUrls,
  extractOutputUrls,
  extractShortlistUrls,
  checkBlockedEvenings,
  checkCalendarConflicts,
  checkSchemaInvariants,
  isBayAreaLocation,
};
