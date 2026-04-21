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
    expect(result.reasons[0]).toMatch(/surfaced only/i);
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
