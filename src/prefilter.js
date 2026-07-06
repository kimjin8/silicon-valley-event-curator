// ============================================================
// prefilter.js — Drop physically un-attendable events before AI
// ============================================================
//
// The AI judges *interest* (topic fit, value, vibe). It should
// not also be expected to reliably enforce *physics*:
//   - "you cannot attend an event that overlaps a busy calendar block"
//
// In practice Gemini fails this check at scale (26 busy events
// × 100+ candidate events) even with explicit corrective feedback.
// So we filter them out at input time. The validator still runs
// on the AI's output as a safety net.
//
// We pre-filter ONLY hard invariants — never preferences, ranking,
// region rules, or interest matching. Those remain the AI's job.
// ============================================================

function buildBusyIntervals(busyEvents) {
  const intervals = [];
  for (const b of busyEvents || []) {
    const bs = b.start?.dateTime || b.start?.date;
    const be = b.end?.dateTime || b.end?.date;
    if (!bs || !be) continue;
    const start = new Date(bs).getTime();
    const end = new Date(be).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    intervals.push({ start, end, summary: b.summary || "(busy)" });
  }
  return intervals;
}

// Home-area airports and cities. A flight *departing* one of these opens an
// "away" window; a flight *arriving* at one closes it. Being out of town is
// physics, not preference — you can't attend a Bay Area event from another
// city — so, like calendar conflicts, it belongs here rather than relying on
// the AI to infer it from a pair of flight events (which it does not do
// reliably). A short "🚌 Travel" buffer is not a flight and never opens a
// window; only events naming an actual flight do.
const HOME_AIRPORTS = ["SFO", "OAK", "SJC"];
const HOME_CITIES = ["SAN FRANCISCO", "OAKLAND", "SAN JOSE"];

function isFlightEvent(ev) {
  return /\bflight\b/i.test(ev?.summary || "") || /✈/.test(ev?.summary || "");
}

// Decide whether each end of a flight is home. Prefer the structured location
// ("SFO - San Francisco, CA to AUS - Austin, TX") and fall back to the
// summary ("Flight SFO to Austin"); never concatenate the two, or a
// home airport named on one side leaks into the other.
function flightEndpoints(ev) {
  const loc = (ev.location || "").toUpperCase();
  const sum = (ev.summary || "").toUpperCase();
  const text = /\bTO\b/.test(loc) ? loc : sum;
  const idx = text.search(/\bTO\b/);
  const origin = idx >= 0 ? text.slice(0, idx) : text;
  const dest = idx >= 0 ? text.slice(idx + 2) : "";
  const isHome = (s) =>
    HOME_AIRPORTS.some((a) => new RegExp(`\\b${a}\\b`).test(s)) ||
    HOME_CITIES.some((c) => s.includes(c));
  return { departsHome: isHome(origin), arrivesHome: isHome(dest) };
}

// Largest value new Date(ms).toISOString() will accept. Used as the end of an
// open-ended trip so it stays a valid, serializable timestamp.
const FAR_FUTURE_MS = 8_640_000_000_000_000;

/**
 * Derive "away from home" intervals from flight events on the calendar. An
 * outbound leg (departs home, does not arrive home) opens a window; the next
 * inbound leg (arrives home) closes it.
 *
 * If no return is visible, the user stays away indefinitely: the calendar is
 * only fetched 7 days out, so a return that lands late on the final day falls
 * just outside the window. Capping at the digest's end would let that day's
 * evening events slip through, so an unpaired outbound drops everything from
 * departure onward — "left, not seen returning" means gone for the rest of
 * the digest.
 */
function detectAwayWindows(busyEvents) {
  const flights = (busyEvents || [])
    .filter(isFlightEvent)
    .map((e) => ({
      start: new Date(e.start?.dateTime || e.start?.date).getTime(),
      end: new Date(e.end?.dateTime || e.end?.date).getTime(),
      ...flightEndpoints(e),
    }))
    .filter((f) => Number.isFinite(f.start) && Number.isFinite(f.end))
    .sort((a, b) => a.start - b.start);

  const windows = [];
  for (const f of flights) {
    if (!f.departsHome || f.arrivesHome) continue; // only outbound legs open a window
    const ret = flights.find(
      (g) => g.start >= f.end && g.arrivesHome && !g.departsHome
    );
    windows.push({
      start: f.start,
      end: ret ? ret.end : FAR_FUTURE_MS,
      summary: "traveling — out of the Bay Area",
      travel: true,
    });
  }
  return windows;
}

/**
 * Returns the busy interval that overlaps the given event, or null.
 * Overlap = event_start < busy_end AND busy_start < event_end.
 */
function findCalendarConflict(event, busyIntervals) {
  if (!event?.date || !event?.endDate) return null;
  const eStart = new Date(event.date).getTime();
  const eEnd = new Date(event.endDate).getTime();
  if (!Number.isFinite(eStart) || !Number.isFinite(eEnd)) return null;
  for (const c of busyIntervals) {
    if (eStart < c.end && c.start < eEnd) return c;
  }
  return null;
}

/**
 * Apply hard-invariant pre-filtering to the merged scraper data.
 * Returns a NEW mergedData object with luma + cv events filtered down.
 * SF IRL events come as raw text only and are not filtered (the AI
 * has to parse them anyway).
 *
 * Also returns a `prefilterReport` describing what was dropped, for
 * logging and diagnostics.
 */
function prefilterMergedData(mergedData) {
  const busyIntervals = buildBusyIntervals(mergedData?.busyCalendarEvents);
  const awayWindows = detectAwayWindows(mergedData?.busyCalendarEvents);
  const allIntervals = [...busyIntervals, ...awayWindows];

  const drops = [];

  function filterEvents(events) {
    if (!Array.isArray(events)) return events;
    return events.filter((e) => {
      const conflict = findCalendarConflict(e, allIntervals);
      if (conflict) {
        drops.push({
          name: e.name,
          datePT: e.datePT,
          startTimePT: e.startTimePT,
          reason: conflict.travel
            ? "traveling — out of the Bay Area"
            : `calendar conflict with "${conflict.summary}"`,
        });
        return false;
      }
      return true;
    });
  }

  const luma = mergedData?.lumaSFEvents;
  const cv = mergedData?.cerebralValleyEvents;

  const filteredMerged = {
    ...mergedData,
    lumaSFEvents: luma
      ? { ...luma, events: filterEvents(luma.events || []) }
      : luma,
    cerebralValleyEvents: cv
      ? { ...cv, events: filterEvents(cv.events || []) }
      : cv,
  };

  const beforeLuma = (luma?.events || []).length;
  const beforeCV = (cv?.events || []).length;
  const afterLuma = filteredMerged.lumaSFEvents?.events?.length || 0;
  const afterCV = filteredMerged.cerebralValleyEvents?.events?.length || 0;

  return {
    mergedData: filteredMerged,
    prefilterReport: {
      droppedCount: drops.length,
      drops,
      luma: { before: beforeLuma, after: afterLuma },
      cerebralValley: { before: beforeCV, after: afterCV },
      awayWindows: awayWindows.map((w) => ({
        from: new Date(w.start).toISOString(),
        to: new Date(w.end).toISOString(),
      })),
    },
  };
}

module.exports = {
  prefilterMergedData,
  findCalendarConflict,
  buildBusyIntervals,
  detectAwayWindows,
};
