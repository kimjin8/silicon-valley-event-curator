// ============================================================
// render.test.js — Deterministic digest rendering
// ============================================================
// Vitest globals (describe, it, expect) are available automatically

const { renderDigest, calendarHeadsUp } = require("../src/render");

const cand = (over = {}) => ({
  id: "e1",
  name: "Llama Lounge 26",
  source: "Cerebral Valley",
  url: "https://luma.com/llamalounge26",
  date: "2026-09-11T00:00:00.000Z",
  endDate: "2026-09-11T04:00:00.000Z",
  dayOfWeek: "Thursday",
  datePT: "Sep 10",
  startTimePT: "5:00 PM",
  displayTime: "5:00 PM – 9:00 PM",
  location: "Microsoft, Mountain View, CA",
  region: "South Bay",
  dayType: "weekday",
  isFree: true,
  price: null,
  hosts: "",
  description: "",
  ...over,
});

const dateRange = { weekLabelPT: "September 7 – September 14, 2026" };

// Every href in the shortlist section, in order, plus the card title next to it.
function cardLinks(html) {
  const section = html.slice(html.indexOf("SHORTLISTED FOR YOU"), html.indexOf("Calendar heads-up") > 0 ? html.indexOf("Calendar heads-up") : undefined);
  return [...section.matchAll(/<a href="([^"]+)"[^>]*><h3[^>]*>([^<]+)<\/h3>/g)].map((m) => [m[1], m[2]]);
}

describe("renderDigest", () => {
  it("links each shortlisted card to that event's own URL, never another's", () => {
    // Regression for the 2026-09-07 digest: four cards, four wrong links.
    const candidates = [
      cand(),
      cand({ id: "e2", name: "Growth Leaders Breakfast", url: "https://luma.com/dd9d1bi8", date: "2026-09-09T16:00:00Z", dayOfWeek: "Wednesday", datePT: "Sep 9" }),
      cand({ id: "e3", name: "Open Model Hack", url: "https://luma.com/openmodelhack", date: "2026-09-12T16:30:00Z", dayOfWeek: "Saturday", datePT: "Sep 12", region: "SF", dayType: "weekend" }),
    ];
    const decisions = [
      { id: "e3", verdict: "shortlist", blurb: "Hack on open models.", tags: ["AI"], radarReason: "" },
      { id: "e1", verdict: "shortlist", blurb: "Startup demos.", tags: ["Startups"], radarReason: "" },
      { id: "e2", verdict: "skip", blurb: "", tags: [], radarReason: "" },
    ];
    const html = renderDigest({ dateRange, candidates, decisions });

    expect(cardLinks(html)).toEqual([
      ["https://luma.com/llamalounge26", "Llama Lounge 26"],
      ["https://luma.com/openmodelhack", "Open Model Hack"],
    ]);
    expect(html).toContain("SHORTLISTED FOR YOU (2 EVENTS)");
    expect(html).not.toContain("dd9d1bi8");
    expect(html).not.toContain("Growth Leaders Breakfast");
    // Register button uses the same URL as the title
    expect(html.match(/https:\/\/luma\.com\/llamalounge26/g)).toHaveLength(2);
  });

  it("uses the pre-computed PT fields verbatim for the date badge and time line", () => {
    const html = renderDigest({ dateRange, candidates: [cand()], decisions: [{ id: "e1", verdict: "shortlist", blurb: "x", tags: [], radarReason: "" }] });
    expect(html).toContain("THURSDAY · SEP 10");
    expect(html).toContain("⏰ 5:00 PM – 9:00 PM | 📍 Microsoft, Mountain View, CA");
    expect(html).toContain("South Bay ✅");
    expect(html).toContain("Week of September 7 – September 14, 2026");
    expect(html).toContain("Source: Cerebral Valley");
  });

  it("ignores decisions for ids that are not candidates", () => {
    const html = renderDigest({ dateRange, candidates: [cand()], decisions: [{ id: "e42", verdict: "shortlist", blurb: "ghost", tags: [], radarReason: "" }] });
    expect(html).toContain("SHORTLISTED FOR YOU (0 EVENTS)");
    expect(html).not.toContain("ghost");
  });

  it("renders radar items with the AI's reason label and the event's own link", () => {
    const html = renderDigest({
      dateRange,
      candidates: [cand({ region: "SF", location: "San Francisco, CA", isFree: false })],
      decisions: [{ id: "e1", verdict: "radar", blurb: "Great but SF.", tags: [], radarReason: "SF on Weekday" }],
    });
    expect(html).toContain("ALSO ON YOUR RADAR");
    expect(html).toContain("SF on Weekday");
    expect(html).toContain('<a href="https://luma.com/llamalounge26"');
    expect(html).toContain("SHORTLISTED FOR YOU (0 EVENTS)");
    // unknown price: no empty "|  |" segment
    expect(html).toContain("5:00 PM – 9:00 PM | San Francisco, CA | Source: Cerebral Valley");
  });

  it("escapes AI-written text and event names", () => {
    const html = renderDigest({
      dateRange,
      candidates: [cand({ name: 'Tom & Jerry <Live>' })],
      decisions: [{ id: "e1", verdict: "shortlist", blurb: '<script>alert(1)</script>', tags: [], radarReason: "" }],
      note: "A & B",
    });
    expect(html).toContain("Tom &amp; Jerry &lt;Live&gt;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("⚡ Note:</span> A &amp; B");
  });

  it("mentions how many events the prefilter dropped", () => {
    const html = renderDigest({ dateRange, candidates: [cand()], decisions: [], prefilterReport: { droppedCount: 74, awayWindows: [] } });
    expect(html).toContain("74 more skipped for calendar conflicts or travel");
  });
});

describe("calendarHeadsUp", () => {
  it("groups busy blocks by Pacific day with PT time ranges", () => {
    const html = calendarHeadsUp([
      { summary: "Gym Block", start: { dateTime: "2026-09-12T10:00:00-07:00" }, end: { dateTime: "2026-09-12T13:00:00-07:00" } },
      { summary: "Church", start: { dateTime: "2026-09-13T17:00:00-07:00" }, end: { dateTime: "2026-09-13T18:30:00-07:00" } },
      { summary: "Zhanwang in town", start: { date: "2026-09-11" }, end: { date: "2026-09-15" } },
    ]);
    expect(html).toContain("<strong>Sat Sep 12:</strong> Gym Block (10:00 AM – 1:00 PM)");
    expect(html).toContain("<strong>Sun Sep 13:</strong> Church (5:00 PM – 6:30 PM)");
    expect(html).toContain("Zhanwang in town (all day)");
  });

  it("names travel windows from the prefilter", () => {
    const html = calendarHeadsUp([], { awayWindows: [{ from: "2026-07-09T23:29:00.000Z", to: "2026-07-14T06:50:00.000Z" }] });
    expect(html).toContain("✈️ Out of town from Thursday Jul 9 to Monday Jul 13");
  });

  it("returns nothing when there is nothing to say", () => {
    expect(calendarHeadsUp([], null)).toBe("");
  });
});
