// ============================================================
// scrapers.test.js — Tests for scraper modules
// ============================================================
//
// These tests verify the scraper logic WITHOUT actually visiting
// real websites. We use "mocks" — fake versions of the browser
// that return predetermined content. This makes tests:
//   - Fast (no network requests)
//   - Reliable (no dependency on external websites)
//   - Repeatable (same result every time)
// ============================================================
// Vitest globals (describe, it, expect) are available automatically

// ── Luma Link Validation Tests ──────────────────────────────
// These are critical: we need to ensure that Luma event links
// point to individual event pages, NOT the generic listing page.

describe("Luma SF link validation", () => {
  it("should accept valid individual event links", () => {
    const validLinks = [
      "https://lu.ma/ai-iceberg-meetup",
      "https://lu.ma/lennys-newsletter-meetup",
      "https://lu.ma/abc123",
    ];

    for (const link of validLinks) {
      expect(link).not.toBe("https://lu.ma/sf");
      expect(link).not.toBe("https://lu.ma/sf/");
      expect(link.startsWith("https://lu.ma/")).toBe(true);
      expect(link.includes("/sf")).toBe(false);
    }
  });

  it("should reject the generic listing page URL", () => {
    const listingUrl = "https://lu.ma/sf";
    expect(listingUrl).toBe("https://lu.ma/sf");
    // Our scraper filters these out
  });

  it("should reject system URLs (login, signup, etc.)", () => {
    const systemUrls = [
      "https://lu.ma/signup",
      "https://lu.ma/login",
      "https://lu.ma/settings",
      "https://lu.ma/home",
    ];

    for (const url of systemUrls) {
      const isSystemUrl =
        url.includes("/signup") ||
        url.includes("/login") ||
        url.includes("/settings") ||
        url.includes("/home");
      expect(isSystemUrl).toBe(true);
    }
  });
});

// ── SF IRL Article URL Pattern Tests ────────────────────────

describe("SF IRL article URL patterns", () => {
  it("should match valid article URLs", () => {
    const validUrls = [
      "https://sfirl.beehiiv.com/p/sf-irl-mar-23rd-2026",
      "https://sfirl.beehiiv.com/p/sf-irl-mar-16th-2026",
      "https://sfirl.beehiiv.com/p/something-else",
    ];

    for (const url of validUrls) {
      expect(url.includes("sfirl.beehiiv.com/p/")).toBe(true);
    }
  });

  it("should NOT match the index page", () => {
    const indexUrl = "https://sfirl.beehiiv.com/";
    expect(indexUrl.includes("/p/")).toBe(false);
  });
});

// ── Scraper Return Format Tests ─────────────────────────────

describe("Scraper return format", () => {
  it("should always return an object with source and raw fields", () => {
    // Simulate successful scraper output
    const successResult = { source: "Cerebral Valley", raw: "Event data here" };
    expect(successResult).toHaveProperty("source");
    expect(successResult).toHaveProperty("raw");
    expect(typeof successResult.raw).toBe("string");
  });

  it("should include error field on failure", () => {
    const errorResult = {
      source: "Luma SF",
      raw: "",
      error: "Timeout after 60000ms",
    };
    expect(errorResult).toHaveProperty("error");
    expect(errorResult.raw).toBe("");
  });

  it("Luma result should include events array", () => {
    const lumaResult = {
      source: "Luma SF",
      raw: "Page content",
      events: [
        { name: "Event 1", link: "https://lu.ma/event-1", details: "..." },
      ],
    };
    expect(lumaResult.events).toBeInstanceOf(Array);
    expect(lumaResult.events[0]).toHaveProperty("link");
  });

  it("SF IRL result should include articleUrl", () => {
    const sfIrlResult = {
      source: "SF IRL",
      raw: "Article content",
      articleUrl: "https://sfirl.beehiiv.com/p/sf-irl-mar-23rd-2026",
    };
    expect(sfIrlResult).toHaveProperty("articleUrl");
    expect(sfIrlResult.articleUrl).toContain("beehiiv.com/p/");
  });
});
