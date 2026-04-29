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

  const drops = [];

  function filterEvents(events) {
    if (!Array.isArray(events)) return events;
    return events.filter((e) => {
      const conflict = findCalendarConflict(e, busyIntervals);
      if (conflict) {
        drops.push({
          name: e.name,
          datePT: e.datePT,
          startTimePT: e.startTimePT,
          reason: `calendar conflict with "${conflict.summary}"`,
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
    },
  };
}

module.exports = {
  prefilterMergedData,
  findCalendarConflict,
  buildBusyIntervals,
};
