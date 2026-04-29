// ============================================================
// validator.test.js — Tests for curator output sanity checks
// ============================================================
//
// The validator guards against two failure modes we've seen:
// - Hallucinated URLs (AI invents a domain that wasn't in input)
// - Dropped-all-events (0 shortlisted + near-0 radar despite many
//   scraped events — the 10am 2026-04-20 incident)
// ============================================================

const {
  validateCurationOutput,
  urlInInput,
  collectInputUrls,
  extractOutputUrls,
  extractShortlistUrls,
  checkBlockedEvenings,
  checkCalendarConflicts,
  checkSchemaInvariants,
  isBayAreaLocation,
} = require("../src/validator");

// ── Minimal helpers to build realistic test fixtures ────────

function makeMergedData({ luma = [], cv = [], sfIrlRaw = "", sfIrlArticleUrl = null } = {}) {
  return {
    lumaSFEvents: { source: "Luma SF", raw: "", events: luma },
    cerebralValleyEvents: { source: "Cerebral Valley", raw: "", events: cv },
    sfIrlEvents: {
      source: "SF IRL",
      raw: sfIrlRaw,
      ...(sfIrlArticleUrl ? { articleUrl: sfIrlArticleUrl } : {}),
    },
  };
}

function htmlShortlistCount(n, extraLinks = []) {
  const links = extraLinks
    .map((u) => `<a href="${u}">Event</a>`)
    .join("\n");
  return `
    <div>SHORTLISTED FOR YOU (${n} EVENTS)</div>
    ${links}
    <div>ALSO ON YOUR RADAR</div>
  `;
}

// ── collectInputUrls ────────────────────────────────────────

describe("collectInputUrls", () => {
  it("gathers Luma event.link, CV event.url, SF IRL articleUrl, and URLs in raw text", () => {
    const merged = makeMergedData({
      luma: [{ link: "https://lu.ma/abc123" }, { link: "https://lu.ma/xyz789" }],
      cv: [{ url: "https://cerebralvalley.ai/e/some-event" }],
      sfIrlArticleUrl: "https://sfirl.beehiiv.com/p/sf-irl-apr-20th-2026",
      sfIrlRaw: "Check out https://lu.ma/embedded-link and more at https://example.com/foo",
    });
    const urls = collectInputUrls(merged);
    expect(urls.has("https://lu.ma/abc123")).toBe(true);
    expect(urls.has("https://lu.ma/xyz789")).toBe(true);
    expect(urls.has("https://cerebralvalley.ai/e/some-event")).toBe(true);
    expect(urls.has("https://sfirl.beehiiv.com/p/sf-irl-apr-20th-2026")).toBe(true);
    expect(urls.has("https://lu.ma/embedded-link")).toBe(true);
    expect(urls.has("https://example.com/foo")).toBe(true);
  });

  it("handles missing sources gracefully", () => {
    expect(collectInputUrls({}).size).toBe(0);
    expect(collectInputUrls(null).size).toBe(0);
  });
});

// ── urlInInput ──────────────────────────────────────────────

describe("urlInInput", () => {
  const inputUrls = new Set([
    "https://lu.ma/abc123",
    "https://cerebralvalley.ai/e/hackathon-2026",
    "https://sfirl.beehiiv.com/p/sf-irl-apr-20th-2026",
  ]);

  it("accepts an exact match", () => {
    expect(urlInInput("https://lu.ma/abc123", inputUrls)).toBe(true);
  });

  it("treats lu.ma and luma.com as the same platform (AI often rewrites)", () => {
    expect(urlInInput("https://luma.com/abc123", inputUrls)).toBe(true);
  });

  it("ignores trailing slash and http/https differences", () => {
    expect(urlInInput("http://lu.ma/abc123/", inputUrls)).toBe(true);
  });

  it("rejects a hallucinated domain with a unique slug", () => {
    expect(
      urlInInput(
        "https://fake-invented-site.com/call-for-applications-unique-slug-xyzzy",
        inputUrls
      )
    ).toBe(false);
  });

  it("accepts when output slug appears as substring of a legitimate input URL", () => {
    expect(
      urlInInput("https://randomhost.com/hackathon-2026", inputUrls)
    ).toBe(true);
  });

  it("does not crash on malformed URLs", () => {
    expect(urlInInput("not-a-url", inputUrls)).toBe(false);
    expect(urlInInput("", inputUrls)).toBe(true);
  });
});

// ── extractOutputUrls ───────────────────────────────────────

describe("extractOutputUrls", () => {
  it("only extracts hrefs from the shortlist section onward", () => {
    const html = `
      <a href="https://example.com/header-ignored">Header link</a>
      <div>SHORTLISTED FOR YOU (1 EVENTS)</div>
      <a href="https://lu.ma/event1">Event 1</a>
      <div>ALSO ON YOUR RADAR</div>
      <a href="https://lu.ma/event2">Radar event</a>
    `;
    const urls = extractOutputUrls(html);
    expect(urls).toContain("https://lu.ma/event1");
    expect(urls).toContain("https://lu.ma/event2");
    expect(urls).not.toContain("https://example.com/header-ignored");
  });

  it("skips mailto/tel/anchor hrefs", () => {
    const html = `
      SHORTLISTED FOR YOU (1 EVENTS)
      <a href="mailto:me@example.com">email</a>
      <a href="#top">top</a>
      <a href="https://lu.ma/real">real</a>
    `;
    expect(extractOutputUrls(html)).toEqual(["https://lu.ma/real"]);
  });
});

// ── validateCurationOutput ──────────────────────────────────

describe("validateCurationOutput — URL fidelity", () => {
  it("passes when all output URLs trace to input events", () => {
    const merged = makeMergedData({
      luma: [{ link: "https://lu.ma/real-event" }],
      cv: [{ url: "https://cerebralvalley.ai/e/cv-event" }],
    });
    const html = htmlShortlistCount(2, [
      "https://lu.ma/real-event",
      "https://cerebralvalley.ai/e/cv-event",
    ]);
    const result = validateCurationOutput(html, merged);
    expect(result.ok).toBe(true);
    expect(result.stats.unknownUrlCount).toBe(0);
  });

  it("fails when AI invents a URL with a domain+slug not in the input", () => {
    const merged = makeMergedData({
      luma: [{ link: "https://lu.ma/real-event" }],
    });
    const html = htmlShortlistCount(1, [
      "https://fake-invented-host.com/never-seen-slug-abcdefg-xyz",
    ]);
    const result = validateCurationOutput(html, merged);
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/hallucinated/i);
  });
});

describe("validateCurationOutput — coverage floor", () => {
  function fakeEvents(n) {
    return Array.from({ length: n }, (_, i) => ({ link: `https://lu.ma/evt-${i}` }));
  }

  it("passes when many events surfaced from many scraped", () => {
    const merged = makeMergedData({ luma: fakeEvents(50) });
    const html = htmlShortlistCount(5, [
      "https://lu.ma/evt-0",
      "https://lu.ma/evt-1",
      "https://lu.ma/evt-2",
      "https://lu.ma/evt-3",
      "https://lu.ma/evt-4",
    ]);
    const result = validateCurationOutput(html, merged);
    expect(result.ok).toBe(true);
  });

  it("fails when AI drops nearly everything despite abundant input", () => {
    // 98 scraped events, 0 shortlisted, 0 radar — the 10am 2026-04-20 incident
    const merged = makeMergedData({ luma: fakeEvents(98) });
    const html = `<div>SHORTLISTED FOR YOU (0 EVENTS)</div><div>ALSO ON YOUR RADAR</div>`;
    const result = validateCurationOutput(html, merged);
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/surfaced 0/i);
    expect(result.stats.shortlistCount).toBe(0);
    expect(result.stats.radarCount).toBe(0);
  });

  it("does not trip the floor when input itself was small", () => {
    // Skinny input (e.g. scrapers had issues) — don't penalize AI for a thin digest
    const merged = makeMergedData({ luma: fakeEvents(3) });
    const html = `<div>SHORTLISTED FOR YOU (0 EVENTS)</div><div>ALSO ON YOUR RADAR</div>`;
    const result = validateCurationOutput(html, merged);
    expect(result.ok).toBe(true);
  });
});

// ── extractShortlistUrls ────────────────────────────────────

describe("extractShortlistUrls", () => {
  it("returns only hrefs between SHORTLISTED and ALSO ON YOUR RADAR", () => {
    const html = `
      <a href="https://example.com/header">header</a>
      <div>SHORTLISTED FOR YOU (1 EVENTS)</div>
      <a href="https://lu.ma/short1">in shortlist</a>
      <div>ALSO ON YOUR RADAR</div>
      <a href="https://lu.ma/radar1">in radar — must be excluded</a>
    `;
    const urls = extractShortlistUrls(html);
    expect(urls).toContain("https://lu.ma/short1");
    expect(urls).not.toContain("https://lu.ma/radar1");
    expect(urls).not.toContain("https://example.com/header");
  });
});

// ── Register-button URL coverage ────────────────────────────

describe("validateCurationOutput — every shortlisted card needs a real URL", () => {
  // The 2026-04-27 11:16am email had a card with href="#" (un-clickable
  // Register button). Validator should catch that.
  it("fails when a shortlist card uses href=\"#\" placeholder", () => {
    const merged = makeMergedData({
      luma: [
        { link: "https://lu.ma/real-event-1" },
        { link: "https://lu.ma/real-event-2" },
        { link: "https://lu.ma/real-event-3" },
      ],
    });
    const html = `
      <div>SHORTLISTED FOR YOU (3 EVENTS)</div>
      <a href="#">Register →</a>
      <a href="https://lu.ma/real-event-2">Register →</a>
      <a href="#">Register →</a>
      <div>ALSO ON YOUR RADAR</div>
    `;
    const result = validateCurationOutput(html, merged);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/placeholder/i);
  });

  it("passes when every shortlisted card has a unique registration URL", () => {
    const merged = makeMergedData({
      luma: [
        { link: "https://lu.ma/a" },
        { link: "https://lu.ma/b" },
        { link: "https://lu.ma/c" },
      ],
    });
    const html = `
      <div>SHORTLISTED FOR YOU (3 EVENTS)</div>
      <a href="https://lu.ma/a">Register</a>
      <a href="https://lu.ma/b">Register</a>
      <a href="https://lu.ma/c">Register</a>
      <div>ALSO ON YOUR RADAR</div>
    `;
    const result = validateCurationOutput(html, merged);
    expect(result.ok).toBe(true);
  });
});

// ── checkBlockedEvenings ────────────────────────────────────

describe("checkBlockedEvenings — config-driven rule", () => {
  // user-config.js currently sets blockedEvenings: [] — Wed evenings are
  // handled via the Dwell Small Group calendar event, not a static rule.
  // The rule remains in code so a user can re-enable it via config.
  it("when blockedEvenings is empty, does not flag any shortlisted event", () => {
    const merged = {
      lumaSFEvents: {
        events: [
          {
            link: "https://lu.ma/wed-evening",
            name: "Wed Evening Mixer",
            dayOfWeek: "Wednesday",
            startTimePT: "6:00 PM",
            endTimePT: "8:00 PM",
            date: "2026-04-29T01:00:00Z",
            endDate: "2026-04-29T03:00:00Z",
            datePT: "Apr 29",
          },
        ],
      },
      cerebralValleyEvents: { events: [] },
      sfIrlEvents: { raw: "" },
    };
    const html = `
      <div>SHORTLISTED FOR YOU (1 EVENTS)</div>
      <a href="https://lu.ma/wed-evening">Wed Evening Mixer</a>
      <div>ALSO ON YOUR RADAR</div>
    `;
    const result = validateCurationOutput(html, merged);
    expect(result.stats.blockedEveningViolationCount).toBe(0);
  });

  it.skip("(legacy) fails when AI shortlists a Wednesday event starting at 5pm or later", () => {
    const merged = {
      lumaSFEvents: {
        events: [
          {
            link: "https://lu.ma/wed-evening",
            name: "Fintech Founders Pitch",
            dayOfWeek: "Wednesday",
            startTimePT: "5:00 PM",
            endTimePT: "8:00 PM",
            date: "2026-04-29T00:00:00Z",
            endDate: "2026-04-29T03:00:00Z",
            datePT: "Apr 29",
          },
        ],
      },
      cerebralValleyEvents: { events: [] },
      sfIrlEvents: { raw: "" },
    };
    const html = `
      <div>SHORTLISTED FOR YOU (1 EVENTS)</div>
      <a href="https://lu.ma/wed-evening">Fintech Founders Pitch</a>
      <div>ALSO ON YOUR RADAR</div>
    `;
    const result = validateCurationOutput(html, merged);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/blocked.evening/i);
    expect(result.stats.blockedEveningViolationCount).toBe(1);
  });

  it("does not flag Wednesday-MORNING events (8am isn't an evening)", () => {
    const merged = {
      lumaSFEvents: {
        events: [
          {
            link: "https://lu.ma/wed-morning",
            name: "Wed AM Breakfast",
            dayOfWeek: "Wednesday",
            startTimePT: "8:00 AM",
            endTimePT: "10:00 AM",
            date: "2026-04-29T15:00:00Z",
            endDate: "2026-04-29T17:00:00Z",
            datePT: "Apr 29",
          },
        ],
      },
      cerebralValleyEvents: { events: [] },
      sfIrlEvents: { raw: "" },
    };
    const html = `
      <div>SHORTLISTED FOR YOU (1 EVENTS)</div>
      <a href="https://lu.ma/wed-morning">Wed AM Breakfast</a>
      <div>ALSO ON YOUR RADAR</div>
    `;
    const result = validateCurationOutput(html, merged);
    expect(result.stats.blockedEveningViolationCount).toBe(0);
  });

  it("does not flag a Wed-evening event placed in the RADAR section", () => {
    // Radar is informational; the shortlist is the binding commitment.
    const merged = {
      lumaSFEvents: {
        events: [
          {
            link: "https://lu.ma/wed-evening-radar",
            name: "Wed Evening (radar)",
            dayOfWeek: "Wednesday",
            startTimePT: "6:00 PM",
            endTimePT: "8:00 PM",
            date: "2026-04-29T01:00:00Z",
            endDate: "2026-04-29T03:00:00Z",
            datePT: "Apr 29",
          },
        ],
      },
      cerebralValleyEvents: { events: [] },
      sfIrlEvents: { raw: "" },
    };
    const html = `
      <div>SHORTLISTED FOR YOU (0 EVENTS)</div>
      <div>ALSO ON YOUR RADAR</div>
      <a href="https://lu.ma/wed-evening-radar">in radar</a>
    `;
    const result = validateCurationOutput(html, merged);
    expect(result.stats.blockedEveningViolationCount).toBe(0);
  });
});

// ── checkCalendarConflicts ──────────────────────────────────

describe("checkCalendarConflicts — busy-event overlap rule", () => {
  // The May 2 incident: AI shortlisted a hackathon already on the calendar.
  it("fails when a shortlisted event time-overlaps a busy calendar event", () => {
    const merged = {
      lumaSFEvents: {
        events: [
          {
            link: "https://lu.ma/builders-hack",
            name: "Builders of Tomorrow Hackathon",
            dayOfWeek: "Saturday",
            startTimePT: "9:00 AM",
            endTimePT: "6:00 PM",
            date: "2026-05-02T16:00:00Z",
            endDate: "2026-05-03T01:00:00Z",
            datePT: "May 2",
          },
        ],
      },
      cerebralValleyEvents: { events: [] },
      sfIrlEvents: { raw: "" },
      busyCalendarEvents: [
        {
          summary: "Builders of Tomorrow Hackathon",
          start: { dateTime: "2026-05-02T16:00:00Z" },
          end: { dateTime: "2026-05-03T01:00:00Z" },
        },
      ],
    };
    const html = `
      <div>SHORTLISTED FOR YOU (1 EVENTS)</div>
      <a href="https://lu.ma/builders-hack">Hackathon</a>
      <div>ALSO ON YOUR RADAR</div>
    `;
    const result = validateCurationOutput(html, merged);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/conflict/i);
    expect(result.stats.conflictViolationCount).toBe(1);
  });

  it("does not flag when shortlisted event is on a different day", () => {
    const merged = {
      lumaSFEvents: {
        events: [
          {
            link: "https://lu.ma/clear-event",
            name: "Clear Event",
            dayOfWeek: "Friday",
            startTimePT: "10:00 AM",
            endTimePT: "11:00 AM",
            date: "2026-05-01T17:00:00Z",
            endDate: "2026-05-01T18:00:00Z",
            datePT: "May 1",
          },
        ],
      },
      cerebralValleyEvents: { events: [] },
      sfIrlEvents: { raw: "" },
      busyCalendarEvents: [
        {
          summary: "Sat hackathon",
          start: { dateTime: "2026-05-02T16:00:00Z" },
          end: { dateTime: "2026-05-03T01:00:00Z" },
        },
      ],
    };
    const html = `
      <div>SHORTLISTED FOR YOU (1 EVENTS)</div>
      <a href="https://lu.ma/clear-event">Clear</a>
      <div>ALSO ON YOUR RADAR</div>
    `;
    const result = validateCurationOutput(html, merged);
    expect(result.stats.conflictViolationCount).toBe(0);
  });

  it("does not crash when busyCalendarEvents is missing", () => {
    const merged = {
      lumaSFEvents: {
        events: [
          {
            link: "https://lu.ma/x",
            name: "X",
            dayOfWeek: "Friday",
            startTimePT: "10:00 AM",
            endTimePT: "11:00 AM",
            date: "2026-05-01T17:00:00Z",
            endDate: "2026-05-01T18:00:00Z",
            datePT: "May 1",
          },
        ],
      },
      cerebralValleyEvents: { events: [] },
      sfIrlEvents: { raw: "" },
    };
    const html = `<div>SHORTLISTED FOR YOU (1 EVENTS)</div><a href="https://lu.ma/x">x</a><div>ALSO ON YOUR RADAR</div>`;
    expect(() => validateCurationOutput(html, merged)).not.toThrow();
  });
});

// ── Schema invariants: location + sane time range ───────────

describe("isBayAreaLocation", () => {
  it("accepts SF / Bay Area cities", () => {
    expect(isBayAreaLocation("San Francisco, CA")).toBe(true);
    expect(isBayAreaLocation("123 University Ave, Palo Alto, CA")).toBe(true);
    expect(isBayAreaLocation("Mountain View")).toBe(true);
    expect(isBayAreaLocation("Menlo Park, CA, USA")).toBe(true);
  });

  it("rejects non-Bay-Area cities (Reykjavik regression)", () => {
    expect(isBayAreaLocation("Reykjavik, Iceland")).toBe(false);
    expect(isBayAreaLocation("New York, NY")).toBe(false);
    expect(isBayAreaLocation("Los Angeles, CA")).toBe(false);
  });

  it("returns true on missing location (don't reject online/TBD)", () => {
    expect(isBayAreaLocation(null)).toBe(true);
    expect(isBayAreaLocation("")).toBe(true);
  });
});

describe("checkSchemaInvariants", () => {
  function buildIndex(events) {
    const idx = new Map();
    events.forEach((e) => idx.set(e.link.replace(/\/+$/, ""), e));
    return idx;
  }

  it("flags a shortlisted event whose location is outside the Bay Area", () => {
    const events = [
      {
        name: "Iceland AI Tinkerer",
        link: "https://lu.ma/iceland",
        location: "Reykjavik, Iceland",
        dayOfWeek: "Friday",
        startTimePT: "6:00 PM",
        endTimePT: "8:00 PM",
        date: "2026-05-01T01:00:00Z",
        endDate: "2026-05-01T03:00:00Z",
      },
    ];
    const violations = checkSchemaInvariants(
      ["https://lu.ma/iceland"],
      buildIndex(events)
    );
    expect(violations.length).toBe(1);
    expect(violations[0]).toMatch(/Reykjavik/);
  });

  it("flags an impossible same-day overnight time range", () => {
    // Start 7pm and end 3pm on same calendar day = nonsensical
    const events = [
      {
        name: "Scrappy Founders",
        link: "https://lu.ma/scrappy",
        location: "San Francisco, CA",
        dayOfWeek: "Friday",
        startTimePT: "8:00 AM",
        endTimePT: "7:00 AM",
        // Same PT calendar day (May 5), but end is BEFORE start —
        // exactly the malformed-data shape the schema check is meant to catch.
        date: "2026-05-05T15:00:00Z",
        endDate: "2026-05-05T14:00:00Z",
      },
    ];
    const violations = checkSchemaInvariants(
      ["https://lu.ma/scrappy"],
      buildIndex(events)
    );
    expect(violations.length).toBe(1);
    expect(violations[0]).toMatch(/impossible/);
  });

  it("passes a clean Bay Area event with a valid time range", () => {
    const events = [
      {
        name: "Good Event",
        link: "https://lu.ma/good",
        location: "Palo Alto, CA",
        dayOfWeek: "Tuesday",
        startTimePT: "5:00 PM",
        endTimePT: "7:00 PM",
        date: "2026-05-05T00:00:00Z",
        endDate: "2026-05-05T02:00:00Z",
      },
    ];
    const violations = checkSchemaInvariants(
      ["https://lu.ma/good"],
      buildIndex(events)
    );
    expect(violations.length).toBe(0);
  });
});

// ── formatTimeRange: cross-day disambiguation ───────────────

describe("formatTimeRange (overnight / multi-day)", () => {
  const { formatTimeRange } = require("../src/scrapers/utils");

  it("formats a same-day range as bare times", () => {
    // 5pm to 7pm PT on May 5 2026
    const out = formatTimeRange(
      "2026-05-05T17:00:00-07:00",
      "2026-05-05T19:00:00-07:00"
    );
    expect(out).toBe("5:00 PM – 7:00 PM");
  });

  it("prefixes day name when start and end fall on different PT days", () => {
    // 7pm Fri PT to 3pm Sat PT
    const out = formatTimeRange(
      "2026-05-01T19:00:00-07:00",
      "2026-05-02T15:00:00-07:00"
    );
    expect(out).toMatch(/^Fri /);
    expect(out).toMatch(/Sat /);
    expect(out).toMatch(/7:00 PM/);
    expect(out).toMatch(/3:00 PM/);
  });
});
