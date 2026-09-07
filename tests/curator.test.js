// ============================================================
// curator.test.js — Candidate building + judgement prompt
// ============================================================
// Vitest globals (describe, it, expect) are available automatically

const {
  buildCandidates,
  buildJudgementPrompt,
  buildCorrectivePrompt,
  buildGenerationConfig,
  parseDecisions,
  canonicalUrl,
} = require("../src/curator");

const lumaEvent = (over = {}) => ({
  name: "Llama Lounge 26",
  link: "https://lu.ma/llamalounge26",
  date: "2026-09-11T00:00:00.000Z",
  endDate: "2026-09-11T04:00:00.000Z",
  dayOfWeek: "Thursday",
  datePT: "Sep 10",
  startTimePT: "5:00 PM",
  endTimePT: "9:00 PM",
  displayTime: "5:00 PM – 9:00 PM",
  location: "Microsoft, Mountain View, CA",
  city: "Mountain View",
  isFree: true,
  price: null,
  hosts: "Jeremiah Owyang",
  details: "AI startup demos",
  source: "Luma SF",
  ...over,
});

const cvEvent = (over = {}) => ({
  name: "Growth Leaders Breakfast",
  url: "https://luma.com/dd9d1bi8",
  date: "2026-09-09T16:00:00Z",
  endDate: "2026-09-09T18:00:00Z",
  dayOfWeek: "Wednesday",
  datePT: "Sep 9",
  startTimePT: "9:00 AM",
  endTimePT: "11:00 AM",
  displayTime: "9:00 AM – 11:00 AM",
  location: "San Francisco, CA",
  description: "Breakfast for growth leaders",
  source: "Cerebral Valley",
  ...over,
});

function merged({ luma = [], cv = [] } = {}) {
  return {
    lumaSFEvents: { source: "Luma SF", raw: "RAW LUMA TEXT", events: luma },
    cerebralValleyEvents: { source: "Cerebral Valley", raw: "RAW CV TEXT", events: cv },
    sfIrlEvents: { source: "SF IRL", raw: "" },
  };
}

describe("buildCandidates", () => {
  it("assigns ids in date order and carries each event's own URL", () => {
    const cands = buildCandidates(merged({ luma: [lumaEvent()], cv: [cvEvent()] }));
    expect(cands.map((c) => c.id)).toEqual(["e1", "e2"]);
    expect(cands[0].name).toBe("Growth Leaders Breakfast");
    expect(cands[0].url).toBe("https://luma.com/dd9d1bi8");
    expect(cands[1].name).toBe("Llama Lounge 26");
    expect(cands[1].url).toBe("https://lu.ma/llamalounge26");
  });

  it("drops events without a registration URL — the renderer can't link them", () => {
    const cands = buildCandidates(merged({ cv: [cvEvent({ url: null }), cvEvent({ name: "Linked" })] }));
    expect(cands.map((c) => c.name)).toEqual(["Linked"]);
  });

  it("merges the same Luma event listed by both scrapers (lu.ma vs luma.com)", () => {
    const cands = buildCandidates(
      merged({
        luma: [lumaEvent()],
        cv: [cvEvent({ name: "Llama Lounge 26: The AI Startup Event Series", url: "https://luma.com/llamalounge26", date: lumaEvent().date, description: "CV summary" })],
      })
    );
    expect(cands).toHaveLength(1);
    expect(cands[0].isFree).toBe(true);
    expect(cands[0].description).toBe("CV summary");
  });

  it("tags region and day type from the pre-computed fields", () => {
    const [sat, thu] = buildCandidates(
      merged({
        luma: [lumaEvent({ dayOfWeek: "Saturday", date: "2026-09-12T16:30:00Z", location: "San Francisco, CA", link: "https://lu.ma/openmodelhack" })],
        cv: [cvEvent({ date: "2026-09-13T00:00:00Z", dayOfWeek: "Thursday", location: "Palo Alto, California" })],
      })
    );
    expect(sat.dayType).toBe("weekend");
    expect(sat.region).toBe("SF");
    expect(thu.dayType).toBe("weekday");
    expect(thu.region).toBe("South Bay");
  });
});

describe("canonicalUrl", () => {
  it("treats lu.ma, luma.com, www, trailing slash and case as the same event", () => {
    expect(canonicalUrl("https://lu.ma/Abc/")).toBe(canonicalUrl("http://www.luma.com/abc"));
  });
});

describe("buildJudgementPrompt", () => {
  const cands = buildCandidates(merged({ luma: [lumaEvent()], cv: [cvEvent()] }));

  it("lists every candidate by id and never dumps the scrapers' raw text", () => {
    // Regression for the 2026-09-07 digest: the AI resurfaced prefiltered
    // events it could only have seen in the raw summaries.
    const prompt = buildJudgementPrompt(cands);
    expect(prompt).toContain('"id": "e1"');
    expect(prompt).toContain('"id": "e2"');
    expect(prompt).not.toContain("RAW LUMA TEXT");
    expect(prompt).not.toContain("RAW CV TEXT");
  });

  it("does not hand the AI URLs, HTML instructions, or calendar data", () => {
    const prompt = buildJudgementPrompt(cands);
    expect(prompt).not.toContain("lu.ma/llamalounge26");
    expect(prompt).not.toContain("luma.com/dd9d1bi8");
    expect(prompt).not.toMatch(/inline CSS/i);
    expect(prompt).not.toMatch(/calendar busy/i);
  });

  it("includes the user's interests, regions, and budget from user-config", () => {
    const prompt = buildJudgementPrompt(cands);
    expect(prompt).toContain("Interested in: AI");
    expect(prompt).toContain("Not interested in: Healthcare");
    expect(prompt).toContain("Weekday (Mon–Fri) preferred region: South Bay");
    expect(prompt).toContain("Weekend (Sat–Sun) preferred region: SF");
    expect(prompt).toContain("under $50");
  });

  it("includes SF IRL text as signal only, capped in length", () => {
    const prompt = buildJudgementPrompt(cands, { sfIrlRaw: "x".repeat(10000) });
    expect(prompt).toContain("signal only");
    expect(prompt.length).toBeLessThan(9000 + 3000);
  });

  it("tells the AI to shortlist elsewhere when the preferred weekday region has no candidates", () => {
    // The first judgement-only dry run (2026-09-07) returned 0 shortlisted /
    // 6 radar because every attendable event was in SF on a weekday.
    const prompt = buildJudgementPrompt(cands);
    expect(prompt).toContain("If there are NO South Bay weekday candidates at all this week, shortlist the strongest weekday events elsewhere");
  });

  it("asks for JSON verdicts, not HTML", () => {
    const prompt = buildJudgementPrompt(cands);
    expect(prompt).toContain('"verdict": "shortlist" | "radar" | "skip"');
    expect(prompt).not.toMatch(/HTML email/i);
  });
});

describe("buildCorrectivePrompt", () => {
  it("names each reason and appends the original prompt", () => {
    const out = buildCorrectivePrompt("ORIGINAL_PROMPT_BODY", ["Surfaced 0 events", "not valid JSON"]);
    expect(out).toContain("- Surfaced 0 events");
    expect(out).toContain("- not valid JSON");
    expect(out).toContain("=== ORIGINAL PROMPT ===\nORIGINAL_PROMPT_BODY");
  });
});

describe("buildGenerationConfig", () => {
  it("requests JSON with the verdict schema", () => {
    const cfg = buildGenerationConfig("gemini-3-flash-preview");
    expect(cfg.responseMimeType).toBe("application/json");
    expect(cfg.responseSchema.properties.decisions.items.properties.verdict.enum).toEqual([
      "shortlist",
      "radar",
      "skip",
    ]);
  });

  // Regression for INC-007: Gemini 3 ignores thinkingBudget and must be
  // capped via thinkingLevel; Gemini 2.5 predates thinkingLevel.
  it("caps Gemini 3 thinking with thinkingLevel, not thinkingBudget", () => {
    expect(buildGenerationConfig("gemini-3.1-flash-lite").thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(buildGenerationConfig("gemini-3-flash-preview").thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("keeps thinkingBudget for Gemini 2.5", () => {
    expect(buildGenerationConfig("gemini-2.5-flash").thinkingConfig).toEqual({ thinkingBudget: 8192 });
  });
});

describe("parseDecisions", () => {
  it("strips markdown fences some models still add", () => {
    expect(parseDecisions('```json\n{"decisions":[]}\n```')).toEqual({ decisions: [] });
  });

  it("throws on non-JSON so the curator can retry with feedback", () => {
    expect(() => parseDecisions("<div>hello</div>")).toThrow();
  });
});
