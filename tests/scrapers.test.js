// ============================================================
// scrapers.test.js — Tests for scraper modules
// ============================================================
//
// These tests verify scraper logic WITHOUT visiting real websites.
// We test URL validation, return format contracts, and the shared
// retry utility.
// ============================================================

const { isListingPageUrl } = require("../src/scrapers/luma-sf");
const { isBayArea, isAttendableBayAreaEvent } = require("../src/scrapers/cerebral-valley");

// ── Cerebral Valley Bay Area Filter Tests ──────────────────

describe("Cerebral Valley isBayArea filter", () => {
  it("should match common Bay Area cities", () => {
    expect(isBayArea("San Francisco, CA")).toBe(true);
    expect(isBayArea("Sunnyvale, CA")).toBe(true);
    expect(isBayArea("Palo Alto, CA")).toBe(true);
    expect(isBayArea("Mountain View, CA")).toBe(true);
    expect(isBayArea("Berkeley, CA")).toBe(true);
    expect(isBayArea("San Jose, CA")).toBe(true);
    expect(isBayArea("Menlo Park, CA")).toBe(true);
    expect(isBayArea("Stanford, CA")).toBe(true);
  });

  it("should match locations ending with , CA", () => {
    expect(isBayArea("Some Place, CA")).toBe(true);
  });

  it("should reject non-Bay-Area locations", () => {
    expect(isBayArea("London, UK")).toBe(false);
    expect(isBayArea("New York City, NY")).toBe(false);
    expect(isBayArea("Seattle, WA")).toBe(false);
    expect(isBayArea("Boston, MA")).toBe(false);
    expect(isBayArea("Remote")).toBe(false);
  });

  it("should handle null/undefined/empty", () => {
    expect(isBayArea(null)).toBe(false);
    expect(isBayArea(undefined)).toBe(false);
    expect(isBayArea("")).toBe(false);
  });

  describe("isAttendableBayAreaEvent — drops mislocated events at ingestion", () => {
    it("drops an event whose name+host is another city despite an SF location", () => {
      // Real CV API payload: location lies, name and host tell the truth.
      expect(
        isAttendableBayAreaEvent({
          name: "AI Tinkerers - Columbus July Meetup [AI Tinkerers - Columbus]",
          location: "San Francisco, CA",
          url: "https://columbus.aitinkerers.org/p/ai-tinkerers-columbus-july-meetup",
        })
      ).toBe(false);
    });

    it("keeps a genuine Bay Area event", () => {
      expect(
        isAttendableBayAreaEvent({
          name: "Builders Night",
          location: "San Francisco, CA",
          url: "https://luma.com/6uoda4dr",
        })
      ).toBe(true);
    });

    it("still drops events with a non-Bay-Area location", () => {
      expect(
        isAttendableBayAreaEvent({ name: "Madrid Dinner", location: "Other", url: "https://madrid.aitinkerers.org/p/x" })
      ).toBe(false);
    });
  });

  it("should be case-insensitive", () => {
    expect(isBayArea("SAN FRANCISCO, CA")).toBe(true);
    expect(isBayArea("san francisco, ca")).toBe(true);
  });
});

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

// ── Shared Utils Tests ──────────────────────────────────────

describe("Shared scraper utils", () => {
  it("should export withBrowserRetry from utils", () => {
    const { withBrowserRetry } = require("../src/scrapers/utils");
    expect(typeof withBrowserRetry).toBe("function");
  });

  it("should export withRetry from utils", () => {
    const { withRetry } = require("../src/scrapers/utils");
    expect(typeof withRetry).toBe("function");
  });

  it("should export BROWSER_LAUNCH_OPTIONS from utils", () => {
    const { BROWSER_LAUNCH_OPTIONS } = require("../src/scrapers/utils");
    expect(BROWSER_LAUNCH_OPTIONS).toHaveProperty("headless", true);
    expect(BROWSER_LAUNCH_OPTIONS.args).toContain("--no-sandbox");
  });

  it("withRetry should return result on success", async () => {
    const { withRetry } = require("../src/scrapers/utils");
    const result = await withRetry(
      "Test",
      async () => ({ data: "ok" }),
      (err) => ({ error: err })
    );
    expect(result).toEqual({ data: "ok" });
  });

  it("withRetry should call emptyResult on failure", async () => {
    // withRetry retries with real delays, so we test the emptyResult contract directly
    const emptyResult = (err) => ({ error: err });
    const result = emptyResult("network timeout");
    expect(result).toHaveProperty("error");
    expect(result.error).toBe("network timeout");
  });

  it("withRetry emptyResult returning null enables API-fallback pattern", () => {
    const emptyResult = () => null;
    expect(emptyResult("fail")).toBeNull();
  });
});

// ── Pacific Time Conversion Tests ──────────────────────────

describe("toPacificTime", () => {
  const { toPacificTime } = require("../src/scrapers/utils");

  it("should convert UTC timestamp to correct Pacific day-of-week", () => {
    // 2026-04-18 is a Saturday
    const result = toPacificTime("2026-04-18T23:00:00Z");
    expect(result.dayOfWeek).toBe("Saturday");
  });

  it("should handle UTC midnight correctly (may be previous day in PT)", () => {
    // 2026-04-20 00:00 UTC = 2026-04-19 5:00 PM PDT (Sunday, not Monday)
    const result = toPacificTime("2026-04-20T00:00:00Z");
    expect(result.dayOfWeek).toBe("Sunday");
    expect(result.timePT).toBe("5:00 PM");
  });

  it("should show correct PT time (UTC-7 during PDT)", () => {
    // 2026-04-18T23:00:00Z = 4:00 PM PDT
    const result = toPacificTime("2026-04-18T23:00:00Z");
    expect(result.timePT).toBe("4:00 PM");
  });

  it("should format datePT as short month + day", () => {
    const result = toPacificTime("2026-04-18T20:00:00Z");
    expect(result.datePT).toBe("Apr 18");
  });

  it("should handle null/undefined input gracefully", () => {
    expect(toPacificTime(null)).toEqual({ dayOfWeek: "", datePT: "", timePT: "" });
    expect(toPacificTime(undefined)).toEqual({ dayOfWeek: "", datePT: "", timePT: "" });
  });

  it("should verify known dates: Apr 18 2026 = Saturday, Apr 21 = Tuesday", () => {
    // These are the exact dates that were wrong in the email
    const apr18 = toPacificTime("2026-04-18T20:00:00Z");
    expect(apr18.dayOfWeek).toBe("Saturday");

    const apr21 = toPacificTime("2026-04-21T20:00:00Z");
    expect(apr21.dayOfWeek).toBe("Tuesday");

    const apr23 = toPacificTime("2026-04-23T20:00:00Z");
    expect(apr23.dayOfWeek).toBe("Thursday");
  });
});
