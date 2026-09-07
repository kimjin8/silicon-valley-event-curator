// ============================================================
// validator.test.js — Verdict validation
// ============================================================
// Vitest globals (describe, it, expect) are available automatically

const { validateDecisions } = require("../src/validator");

const cands = (n) => Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, name: `Event ${i + 1}` }));

describe("validateDecisions", () => {
  it("keeps verdicts for known ids and normalizes optional fields", () => {
    const r = validateDecisions(
      { decisions: [{ id: "e1", verdict: "shortlist", blurb: " Good. ", tags: ["AI", 7], radarReason: null }] },
      cands(2)
    );
    expect(r.ok).toBe(true);
    expect(r.decisions).toEqual([{ id: "e1", verdict: "shortlist", blurb: "Good.", tags: ["AI"], radarReason: "" }]);
    expect(r.stats.shortlistCount).toBe(1);
  });

  it("ignores ids that are not candidates — the AI cannot surface an event we did not offer", () => {
    // Regression for the 2026-09-07 digest, which shortlisted four events
    // the prefilter had dropped for calendar conflicts.
    const r = validateDecisions(
      { decisions: [{ id: "e99", verdict: "shortlist" }, { id: "e1", verdict: "radar" }] },
      cands(2)
    );
    expect(r.decisions.map((d) => d.id)).toEqual(["e1"]);
    expect(r.stats.unknownIds).toBe(1);
  });

  it("drops invalid verdicts and duplicate ids (first wins)", () => {
    const r = validateDecisions(
      {
        decisions: [
          { id: "e1", verdict: "maybe" },
          { id: "e2", verdict: "skip" },
          { id: "e2", verdict: "shortlist" },
        ],
      },
      cands(2)
    );
    expect(r.decisions).toEqual([{ id: "e2", verdict: "skip", blurb: "", tags: [], radarReason: "" }]);
    expect(r.stats.invalidVerdicts).toBe(1);
  });

  it("fails when the AI surfaces nothing from a rich candidate list", () => {
    const r = validateDecisions({ decisions: cands(12).map((c) => ({ id: c.id, verdict: "skip" })) }, cands(12));
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/Surfaced 0 events/);
  });

  it("allows an empty digest when the input itself was thin", () => {
    const r = validateDecisions({ decisions: [{ id: "e1", verdict: "skip" }] }, cands(3));
    expect(r.ok).toBe(true);
  });

  it("fails on a response without a decisions array", () => {
    expect(validateDecisions({ note: "hi" }, cands(2)).ok).toBe(false);
    expect(validateDecisions(null, cands(2)).ok).toBe(false);
    expect(validateDecisions([], cands(2)).ok).toBe(false);
  });
});
