// ============================================================
// validator.js — Sanity checks on Gemini's JSON verdicts
// ============================================================
//
// The AI only returns {id, verdict, ...} per candidate, so there is
// no longer any URL, date, or location for it to get wrong — the
// renderer takes those from the candidate itself. What remains to
// check is the shape of the answer and that it engaged with the
// input at all (the 2026-04-20 incident: 0 events surfaced from a
// full week of input).
// ============================================================

const VERDICTS = new Set(["shortlist", "radar", "skip"]);

/**
 * Clean the parsed AI response against the candidate list.
 *
 * Unknown ids and invalid verdicts are dropped (the AI can't make us
 * show an event that isn't a candidate). Candidates the AI didn't
 * mention count as "skip". Only an empty digest from a rich input
 * flips ok=false and triggers a corrective retry.
 *
 * @returns {{ok: boolean, reasons: string[], decisions: Array, stats: object}}
 */
function validateDecisions(parsed, candidates) {
  const reasons = [];
  const raw = Array.isArray(parsed?.decisions) ? parsed.decisions : null;
  if (!raw) {
    return {
      ok: false,
      reasons: ['Response must be a JSON object with a "decisions" array'],
      decisions: [],
      stats: { candidateCount: candidates.length },
    };
  }

  const known = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set();
  const decisions = [];
  let unknownIds = 0;
  let invalidVerdicts = 0;

  for (const d of raw) {
    if (!d || typeof d !== "object") continue;
    if (!known.has(d.id)) {
      unknownIds++;
      continue;
    }
    if (seen.has(d.id)) continue;
    if (!VERDICTS.has(d.verdict)) {
      invalidVerdicts++;
      continue;
    }
    seen.add(d.id);
    decisions.push({
      id: d.id,
      verdict: d.verdict,
      blurb: typeof d.blurb === "string" ? d.blurb.trim() : "",
      tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === "string") : [],
      radarReason: typeof d.radarReason === "string" ? d.radarReason.trim() : "",
    });
  }

  const shortlistCount = decisions.filter((d) => d.verdict === "shortlist").length;
  const radarCount = decisions.filter((d) => d.verdict === "radar").length;

  if (candidates.length >= 10 && shortlistCount + radarCount === 0) {
    reasons.push(
      `Surfaced 0 events (0 shortlist + 0 radar) from ${candidates.length} candidates — give a verdict on every id and shortlist the strong matches`
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    decisions,
    stats: {
      candidateCount: candidates.length,
      decisionCount: decisions.length,
      shortlistCount,
      radarCount,
      unknownIds,
      invalidVerdicts,
    },
  };
}

module.exports = { validateDecisions };
