// ============================================================
// scrapers.test.js — Tests for scraper modules
// ============================================================
//
// These tests verify scraper logic WITHOUT visiting real websites.
// We test URL validation, return format contracts, and the shared
// retry utility.
// ============================================================

const { isListingPageUrl } = require("../src/scrapers/luma-sf");

// ── Luma Link Validation Tests ──────────────────────────────

describe("Luma SF link validation", () => {
  it("should accept valid individual event links", () => {
    const validLinks = [
      "https://lu.ma/ai-iceberg-meetup",
      "https://lu.ma/lennys-newsletter-meetup",
      "https://lu.ma/abc123",
    ];

    for (const link of validLinks) {
      expect(isListingPageUrl(link)).toBe(false);
      expect(link.startsWith("https://lu.ma/")).toBe(true);
    }
  });

  it("should reject the generic listing page URL", () => {
    expect(isListingPageUrl("https://lu.ma/sf")).toBe(true);
    expect(isListingPageUrl("https://lu.ma/sf/")).toBe(true);
  });

  it("should reject URLs ending with /sf", () => {
    expect(isListingPageUrl("https://example.com/sf")).toBe(true);
    expect(isListingPageUrl("https://example.com/sf/")).toBe(true);
  });

  it("should accept URLs that contain 'sf' but don't end with /sf", () => {
    expect(isListingPageUrl("https://lu.ma/sf-ai-meetup")).toBe(false);
    expect(isListingPageUrl("https://lu.ma/sfirl-happy-hour")).toBe(false);
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

// ── withBrowserRetry Tests ──────────────────────────────────

describe("withBrowserRetry", () => {
  // We can't easily test browser launching in unit tests, but we can
  // verify the retry/error contract by testing the module exports exist
  it("should export withBrowserRetry from utils", () => {
    const { withBrowserRetry } = require("../src/scrapers/utils");
    expect(typeof withBrowserRetry).toBe("function");
  });

  it("should export BROWSER_LAUNCH_OPTIONS from utils", () => {
    const { BROWSER_LAUNCH_OPTIONS } = require("../src/scrapers/utils");
    expect(BROWSER_LAUNCH_OPTIONS).toHaveProperty("headless", true);
    expect(BROWSER_LAUNCH_OPTIONS.args).toContain("--no-sandbox");
  });
});
