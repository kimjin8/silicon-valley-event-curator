// ============================================================
// prefilter.test.js — Tests for hard-invariant pre-filtering
// ============================================================
// Vitest globals (describe, it, expect) are available automatically

const { prefilterMergedData, detectAwayWindows } = require("../src/prefilter");

// A round trip shaped like the one that caused the miss: out of SFO Thursday
// afternoon, back to SFO the following Monday night.
const OUTBOUND = {
  summary: "Flight SFO to Austin",
  location: "SFO - San Francisco, CA to AUS - Austin, TX",
  start: { dateTime: "2026-07-09T16:29:00-07:00" },
  end: { dateTime: "2026-07-09T20:15:00-07:00" },
};
const RETURN = {
  summary: "Flight Austin to SFO",
  location: "AUS - Austin, TX to SFO - San Francisco, CA",
  start: { dateTime: "2026-07-13T19:59:00-07:00" },
  end: { dateTime: "2026-07-13T23:50:00-07:00" },
};

// Candidate scraper events across the week.
const ev = (name, startISO, endISO) => ({
  name,
  date: startISO,
  endDate: endISO,
  datePT: startISO,
  startTimePT: startISO,
});
const TUE_DAY = ev("Tue South Bay meetup", "2026-07-07T18:00:00-07:00", "2026-07-07T20:00:00-07:00");
const THU_MORNING = ev("Thu morning (pre-flight)", "2026-07-09T10:00:00-07:00", "2026-07-09T11:00:00-07:00");
const THU_EVENING = ev("Thu evening (post-flight)", "2026-07-09T21:00:00-07:00", "2026-07-09T22:00:00-07:00");
const SAT = ev("Sat SF party", "2026-07-11T14:00:00-07:00", "2026-07-11T16:00:00-07:00");
const SUN = ev("Sun SF brunch", "2026-07-12T11:00:00-07:00", "2026-07-12T13:00:00-07:00");

function build(busyCalendarEvents, events) {
  return {
    dateRange: { to: "2026-07-13T22:05:00.000Z" },
    lumaSFEvents: { source: "Luma SF", events },
    cerebralValleyEvents: { source: "Cerebral Valley", events: [] },
    busyCalendarEvents,
  };
}

const names = (r) => r.mergedData.lumaSFEvents.events.map((e) => e.name);

describe("travel-window pre-filtering", () => {
  it("drops events while the user is out of town, keeps ones before the trip", () => {
    // Regression for 2026-07-06: a weekend SF event was shortlisted even
    // though the user flew out Thursday and returned Monday.
    const r = prefilterMergedData(
      build([OUTBOUND, RETURN], [TUE_DAY, THU_MORNING, THU_EVENING, SAT, SUN])
    );
    expect(names(r)).toEqual(["Tue South Bay meetup", "Thu morning (pre-flight)"]);
    expect(r.prefilterReport.drops.map((d) => d.reason)).toEqual([
      "traveling — out of the Bay Area",
      "traveling — out of the Bay Area",
      "traveling — out of the Bay Area",
    ]);
    expect(r.prefilterReport.awayWindows).toHaveLength(1);
  });

  it("keeps the user away through week end when there is no return flight", () => {
    const r = prefilterMergedData(build([OUTBOUND], [TUE_DAY, THU_MORNING, SAT]));
    expect(names(r)).toEqual(["Tue South Bay meetup", "Thu morning (pre-flight)"]);
  });

  it("drops late-final-day events when only the outbound flight is in the 7-day fetch", () => {
    // Regression: the return flight lands late on the last digest day, just
    // past the calendar fetch window, so only the outbound is visible. An
    // open-ended trip must still drop that evening's events, not stop at the
    // digest's end bound.
    const monEvening = ev(
      "Mon Jul 13 evening (still traveling)",
      "2026-07-13T18:00:00-07:00",
      "2026-07-13T21:00:00-07:00"
    );
    const r = prefilterMergedData(build([OUTBOUND], [TUE_DAY, monEvening]));
    expect(names(r)).toEqual(["Tue South Bay meetup"]);
    expect(r.prefilterReport.awayWindows[0].to).toContain("+275760");
  });

  it("ignores short '🚌 Travel' buffers — only real flights open a window", () => {
    const buffer = {
      summary: "🚌 Travel",
      start: { dateTime: "2026-07-11T09:00:00-07:00" },
      end: { dateTime: "2026-07-11T10:00:00-07:00" },
    };
    const r = prefilterMergedData(build([buffer], [SAT, SUN]));
    expect(names(r)).toEqual(["Sat SF party", "Sun SF brunch"]);
    expect(r.prefilterReport.awayWindows).toHaveLength(0);
  });

  it("does not open a window for a trip that arrives home (return leg alone)", () => {
    const r = prefilterMergedData(build([RETURN], [SAT, SUN]));
    expect(names(r)).toEqual(["Sat SF party", "Sun SF brunch"]);
  });
});

describe("detectAwayWindows", () => {
  it("spans from outbound departure to inbound arrival", () => {
    const windows = detectAwayWindows([OUTBOUND, RETURN]);
    expect(windows).toHaveLength(1);
    expect(windows[0].start).toBe(Date.parse("2026-07-09T16:29:00-07:00"));
    expect(windows[0].end).toBe(Date.parse("2026-07-13T23:50:00-07:00"));
  });
});
