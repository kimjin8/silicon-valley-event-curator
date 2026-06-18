// ============================================================
// curator.test.js — Tests for AI curation module
// ============================================================
// Vitest globals (describe, it, expect) are available automatically

const { buildCurationPrompt, buildCorrectivePrompt } = require("../src/curator");

describe("buildCurationPrompt", () => {
  const sampleMergedData = {
    dateRange: {
      from: "2026-03-23T00:00:00Z",
      to: "2026-03-30T00:00:00Z",
    },
    cerebralValleyEvents: {
      source: "Cerebral Valley",
      raw: "AI Startup Demo Day\nMarch 25, 2026\nMenlo Park",
    },
    lumaSFEvents: {
      source: "Luma SF",
      raw: "Tech Meetup\nMarch 26, 2026",
      events: [
        { name: "Tech Meetup", link: "https://lu.ma/tech-meetup", details: "Tech Meetup\nMarch 26" },
      ],
    },
    sfIrlEvents: {
      source: "SF IRL",
      raw: "Founder Happy Hour\nMarch 27",
    },
    busyCalendarEvents: [
      { summary: "Team standup", start: { dateTime: "2026-03-24T09:00:00" } },
    ],
  };

  it("should include all merged data in the prompt", () => {
    const prompt = buildCurationPrompt(sampleMergedData);
    expect(prompt).toContain("Cerebral Valley");
    expect(prompt).toContain("Luma SF");
    expect(prompt).toContain("SF IRL");
    expect(prompt).toContain("Team standup");
  });

  it("should include interest filtering rules", () => {
    const prompt = buildCurationPrompt(sampleMergedData);
    expect(prompt).toContain("AI");
    expect(prompt).toContain("startups");
    expect(prompt).toContain("Healthcare");
  });

  it("should include schedule filtering rules", () => {
    const prompt = buildCurationPrompt(sampleMergedData);
    expect(prompt).toContain("WEEKDAYS");
    expect(prompt).toContain("South Bay");
    expect(prompt).toContain("Also On Your Radar");
  });

  it("should include availability based on user config", () => {
    const prompt = buildCurationPrompt(sampleMergedData);
    // user-config has availability: "all-day"
    expect(prompt).toContain("Available all day");
  });

  it("should include cost filtering rules", () => {
    const prompt = buildCurationPrompt(sampleMergedData);
    expect(prompt).toContain("$50");
    expect(prompt).toContain("Free events are always welcome");
  });

  it("should specify HTML output format", () => {
    const prompt = buildCurationPrompt(sampleMergedData);
    expect(prompt).toContain("Generate ONLY raw HTML content");
    expect(prompt).toContain("inline CSS");
  });

  it("should include the exact design specifications", () => {
    const prompt = buildCurationPrompt(sampleMergedData);
    expect(prompt).toContain("#1a1a2e"); // Dark navy header
    expect(prompt).toContain("#ff6b6b"); // Coral accent
    expect(prompt).toContain("SHORTLISTED FOR YOU");
    expect(prompt).toContain("ALSO ON YOUR RADAR");
    expect(prompt).toContain("Calendar heads-up");
  });

  it("should instruct AI to use specific event URLs (not listing page)", () => {
    const prompt = buildCurationPrompt(sampleMergedData);
    expect(prompt).toContain("specific event registration page");
    expect(prompt).toContain("NOT to a general listing page");
  });
});

describe("buildCorrectivePrompt", () => {
  const validation = {
    reasons: ["Event 'Foo' overlaps busy calendar block", "Used href='#' placeholder"],
  };

  it("should name each validation reason", () => {
    const out = buildCorrectivePrompt("ORIGINAL", validation);
    expect(out).toContain("Event 'Foo' overlaps busy calendar block");
    expect(out).toContain("Used href='#' placeholder");
  });

  it("should include the user's weekday and weekend region names", () => {
    // Regression test for the 2026-06-15 prod failure where `schedule`
    // was referenced without being in scope.
    const out = buildCorrectivePrompt("ORIGINAL", validation);
    expect(out).toContain("South Bay");
    expect(out).toContain("SF");
  });

  it("should append the original prompt verbatim", () => {
    const out = buildCorrectivePrompt("ORIGINAL_PROMPT_BODY", validation);
    expect(out).toContain("=== ORIGINAL PROMPT ===");
    expect(out).toContain("ORIGINAL_PROMPT_BODY");
  });
});

describe("HTML cleanup", () => {
  it("should strip markdown code fences from AI output", () => {
    // Simulating what the curator does with the AI response
    const rawOutput = '```html\n<div>Hello</div>\n```';
    const cleaned = rawOutput
      .replace(/^```html\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    expect(cleaned).toBe("<div>Hello</div>");
  });

  it("should handle clean output (no code fences)", () => {
    const rawOutput = "<div>Hello</div>";
    const cleaned = rawOutput
      .replace(/^```html\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    expect(cleaned).toBe("<div>Hello</div>");
  });
});
