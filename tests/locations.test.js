// ============================================================
// locations.test.js — Location heuristics
// ============================================================
// Vitest globals (describe, it, expect) are available automatically

const { nonBayAreaCityHint, regionOf } = require("../src/locations");

describe("nonBayAreaCityHint", () => {
  it("catches a city named in the URL host subdomain", () => {
    expect(nonBayAreaCityHint("AI Tinkerers", "https://columbus.aitinkerers.org/p/abc")).toBe("columbus");
  });

  it("catches a city named in the event title", () => {
    expect(nonBayAreaCityHint("AI Tinkerers - Reykjavik", "https://lu.ma/x")).toBe("reykjavik");
  });

  it("does not flag genuine Bay Area events or hosts", () => {
    expect(nonBayAreaCityHint("Builders Night SF", "https://luma.com/d6mldy2x")).toBeNull();
  });

  it("does not match a city name embedded inside a larger word", () => {
    expect(nonBayAreaCityHint("An exhausting hackathon", "https://lu.ma/x")).toBeNull();
  });
});

describe("regionOf", () => {
  it("classifies Bay Area sub-regions", () => {
    expect(regionOf("Microsoft, Mountain View, CA")).toBe("South Bay");
    expect(regionOf("Palo Alto, California")).toBe("South Bay");
    expect(regionOf("San Francisco, CA")).toBe("SF");
    expect(regionOf("Menlo Park, CA")).toBe("Peninsula");
    expect(regionOf("Oakland, CA")).toBe("East Bay");
  });

  it("treats South San Francisco as Peninsula, not SF", () => {
    expect(regionOf("South San Francisco, CA")).toBe("Peninsula");
  });

  it("returns Other for unknown or missing locations", () => {
    expect(regionOf("Reykjavik, Iceland")).toBe("Other");
    expect(regionOf(null)).toBe("Other");
  });
});
