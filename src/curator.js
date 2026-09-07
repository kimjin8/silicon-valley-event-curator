// ============================================================
// curator.js — Judgement-only event curation with Gemini
// ============================================================
//
// The AI answers exactly one question per candidate: "would this
// user want to go?" Everything deterministic is done in code:
//
//   - candidates:  built here from the scrapers' structured events
//                  (URL, PT times, region) after the prefilter has
//                  removed anything the user physically can't attend
//   - verdicts:    the AI returns JSON keyed by candidate id — it
//                  never writes a URL, a date, or a line of HTML
//   - rendering:   render.js turns verdicts + candidate data into
//                  the email, so every link is the event's own link
//
// This replaced a design where the AI wrote the whole HTML email.
// It attached other events' registration links to the events it
// picked (2026-09-07 digest) and resurfaced events the prefilter
// had dropped, because the raw text summaries of every scraped
// event were still in its prompt.
// ============================================================

const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  GEMINI_API_KEY,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  AI_REQUEST_TIMEOUT_MS,
} = require("./config");
const userConfig = require("../user-config");
const { regionOf } = require("./locations");
const { validateDecisions } = require("./validator");

const VERDICTS = ["shortlist", "radar", "skip"];
const TAGS = ["AI", "Startups", "Product", "Founders", "Hardware", "Consumer"];

// lu.ma and luma.com are the same event; CV often lists a Luma event too.
function canonicalUrl(u) {
  try {
    const p = new URL(u);
    const host = p.host.replace(/^www\./, "").replace(/^lu\.ma$/, "luma.com");
    return `${host}${p.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return String(u || "").toLowerCase();
  }
}

/**
 * Merge the structured Luma + Cerebral Valley events into one list of
 * attendable candidates the AI can pick from. Only events with a
 * registration URL are eligible: the renderer will not print a card
 * without a link, so the AI must never see one it can't link.
 */
function buildCandidates(mergedData) {
  const luma = (mergedData?.lumaSFEvents?.events || []).map((e) => ({ ...e, url: e.link }));
  const cv = mergedData?.cerebralValleyEvents?.events || [];

  const byUrl = new Map();
  for (const e of [...luma, ...cv]) {
    if (!e.url || !e.date) continue;
    const key = canonicalUrl(e.url);
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...e });
    } else if (!existing.description && e.description) {
      existing.description = e.description;
    }
  }

  return [...byUrl.values()]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((e, i) => ({
      id: `e${i + 1}`,
      name: e.name,
      source: e.source,
      url: e.url,
      date: e.date,
      endDate: e.endDate,
      dayOfWeek: e.dayOfWeek,
      datePT: e.datePT,
      startTimePT: e.startTimePT,
      displayTime: e.displayTime,
      location: e.location || e.city || "",
      region: regionOf(e.location || e.city),
      dayType: /^(Saturday|Sunday)$/.test(e.dayOfWeek) ? "weekend" : "weekday",
      isFree: e.isFree === true,
      price: e.price || null,
      hosts: e.hosts || "",
      description: String(e.description || e.details || "").slice(0, 400),
    }));
}

function buildJudgementPrompt(candidates, { sfIrlRaw = "" } = {}) {
  const { region, interests, schedule, cost } = userConfig;

  const availability = {
    "all-day": "free daytime and evenings",
    "evening-only": "evenings only (has a day job)",
    "daytime-only": "daytime only",
  }[schedule.availability] || schedule.availability;

  const compact = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    when: `${c.dayOfWeek} ${c.datePT}, ${c.displayTime}`,
    dayType: c.dayType,
    location: c.location,
    region: c.region,
    price: c.isFree ? "Free" : c.price || "unknown",
    hosts: c.hosts || undefined,
    source: c.source,
    description: c.description || undefined,
  }));

  const editorial = sfIrlRaw
    ? `\n## EDITORIAL CONTEXT (SF IRL newsletter — signal only)\nUse this to spot events the local community is excited about. You can only pick candidates by id; events mentioned here that are not candidates cannot be selected.\n\n${sfIrlRaw.slice(0, 6000)}\n`
    : "";

  return `You are the judgement layer of an event curator for a tech professional in the ${region}.

Everything deterministic has already been done by code: calendar conflicts, travel, dates, times, and registration links. Every candidate below is attendable and has a verified link. Your ONLY job is to judge, per candidate, whether this user would want to go.

## USER PROFILE
- Interested in: ${interests.include.join(", ")}
- Not interested in: ${interests.exclude.join(", ")}
- Availability: ${availability}
- Weekday (Mon–Fri) preferred region: ${schedule.weekdayRegion}
- Weekend (Sat–Sun) preferred region: ${schedule.weekendRegion}
- Budget: ${cost.maxPriceUSD == null ? "no price limit" : `under $${cost.maxPriceUSD}`}; any price is fine for: ${cost.priceExceptions.join("; ")}
${schedule.curatorNotes ? `- Notes from the user: ${schedule.curatorNotes}\n` : ""}
## VERDICTS
- "shortlist": strong interest match AND fits the preferred region for its dayType. A weekday event outside ${schedule.weekdayRegion} may be shortlisted only when it is an exceptional match and there is no comparable ${schedule.weekdayRegion} candidate on the same day. If there are NO ${schedule.weekdayRegion} weekday candidates at all this week, shortlist the strongest weekday events elsewhere — they are the only options — rather than returning an empty shortlist. Never shortlist an over-budget event unless it meets a price exception.
- "radar": strong interest match, but excluded by the region preference or price. Set radarReason to a label of at most 4 words (e.g. "SF on Weekday", "Over budget").
- "skip": everything else — weak topic fit, excluded topics, generic networking.
Aim for 3–6 shortlisted and up to 4 on radar. If nothing fits, shortlist nothing rather than padding.

For every shortlist or radar verdict write a blurb: 2–3 sentences on what the event is and why it fits this user, drawn only from the candidate data. Tags come from: ${TAGS.join(", ")}.

## CANDIDATES
${JSON.stringify(compact, null, 1)}
${editorial}
## OUTPUT
Return JSON only, no markdown fences:
{"note": "one or two sentences framing this week's picks", "decisions": [{"id": "e1", "verdict": "shortlist" | "radar" | "skip", "blurb": "...", "tags": ["AI"], "radarReason": ""}]}
Include every candidate id exactly once.`;
}

function buildCorrectivePrompt(originalPrompt, reasons) {
  return (
    `Your previous response was rejected by automatic validation.\n` +
    `Reasons (you MUST fix all of these):\n` +
    reasons.map((r) => `- ${r}`).join("\n") +
    `\n\nRespond again, following the original instructions below exactly.\n` +
    `=== ORIGINAL PROMPT ===\n${originalPrompt}`
  );
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    note: { type: "string" },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: VERDICTS },
          blurb: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          radarReason: { type: "string" },
        },
        required: ["id", "verdict"],
      },
    },
  },
  required: ["decisions"],
};

// Thinking must be capped so it can't consume the output budget. Gemini 3
// silently ignores thinkingBudget on hard prompts (observed ~63k thinking
// tokens against an 8192 budget → MAX_TOKENS truncation); its thinkingLevel
// control IS honored. Gemini 2.5 predates thinkingLevel.
function buildGenerationConfig(name) {
  const generationConfig = {
    temperature: 0.2,
    maxOutputTokens: 16384,
    responseMimeType: "application/json",
    responseSchema: RESPONSE_SCHEMA,
  };

  if (name.startsWith("gemini-3")) {
    generationConfig.thinkingConfig = { thinkingLevel: "low" };
  } else if (name.startsWith("gemini-2.5")) {
    generationConfig.thinkingConfig = { thinkingBudget: 8192 };
  }

  return generationConfig;
}

function parseDecisions(text) {
  const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Ask Gemini for a verdict on every candidate. Primary model, then fallback;
 * each model gets one corrective retry naming the validation failures.
 *
 * @returns {Promise<{decisions: Array, note: string, prompt: string, rawText: string, modelUsed: string, usage: object|null, attempts: Array}>}
 */
async function judgeEvents(candidates, context = {}) {
  console.log(`🤖 Judging ${candidates.length} candidates with Gemini AI...`);

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const prompt = buildJudgementPrompt(candidates, context);

  const models = [
    { name: PRIMARY_MODEL, label: "Gemini 3 Flash Preview (primary)" },
    { name: FALLBACK_MODEL, label: "Gemini 3.1 Flash Lite (fallback)" },
  ];
  const attempts = [];

  for (let i = 0; i < models.length; i++) {
    const { name, label } = models[i];
    let lastReasons = null;

    for (let attemptNum = 0; attemptNum < 2; attemptNum++) {
      const isCorrective = attemptNum > 0;
      const promptToSend = isCorrective ? buildCorrectivePrompt(prompt, lastReasons) : prompt;
      const attemptLabel = isCorrective ? `${label} [retry w/ feedback]` : label;

      try {
        console.log(`   🔄 Trying ${attemptLabel}...`);
        const model = genAI.getGenerativeModel({
          model: name,
          generationConfig: buildGenerationConfig(name),
        });

        const result = await Promise.race([
          model.generateContent(promptToSend),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Gemini request timed out after ${AI_REQUEST_TIMEOUT_MS / 1000}s`)),
              AI_REQUEST_TIMEOUT_MS
            )
          ),
        ]);
        const response = await result.response;
        const text = response.text();
        const usage = response.usageMetadata || null;
        const finishReason = response.candidates?.[0]?.finishReason || "UNKNOWN";
        if (usage) {
          console.log(
            `   📊 Tokens — input: ${usage.promptTokenCount}, output: ${usage.candidatesTokenCount}, thinking: ${usage.thoughtsTokenCount || 0}, finish: ${finishReason}`
          );
        }

        if (finishReason !== "STOP") {
          console.error(`   ⚠ ${attemptLabel}: output truncated (finishReason: ${finishReason})`);
          attempts.push({ model: name, label: attemptLabel, outcome: "truncated", finishReason, usage });
          break; // a corrective retry won't fix truncation — next model
        }

        let parsed;
        try {
          parsed = parseDecisions(text);
        } catch (err) {
          parsed = null;
          lastReasons = [`Response was not valid JSON: ${err.message}`];
        }
        const validation = parsed ? validateDecisions(parsed, candidates) : { ok: false, reasons: lastReasons, stats: {} };

        if (!validation.ok) {
          console.error(`   ⚠ ${attemptLabel}: validation failed: ${validation.reasons.join("; ")}`);
          attempts.push({ model: name, label: attemptLabel, outcome: "invalid", reasons: validation.reasons, stats: validation.stats, usage });
          lastReasons = validation.reasons;
          if (!isCorrective) {
            console.log("   🔁 Retrying same model with corrective feedback...");
            continue;
          }
          break;
        }

        console.log(`✅ AI judgement complete:`, validation.stats);
        attempts.push({ model: name, label: attemptLabel, outcome: "success", stats: validation.stats, usage });
        return {
          decisions: validation.decisions,
          note: typeof parsed.note === "string" ? parsed.note : "",
          prompt: promptToSend,
          rawText: text,
          modelUsed: name,
          usage,
          attempts,
        };
      } catch (err) {
        console.error(`   ❌ ${attemptLabel} failed:`, err.message);
        attempts.push({ model: name, label: attemptLabel, outcome: "error", error: err.message });
        break; // API errors — don't spend a corrective retry, next model
      }
    }

    if (i < models.length - 1) console.log("   ⚠ Falling back to next model...");
  }

  const summary = attempts
    .map((a) => `${a.label}: ${a.outcome}${a.error ? ` (${a.error})` : ""}${a.reasons ? ` — ${a.reasons.join("; ")}` : ""}`)
    .join("\n  ");
  throw new Error("All AI models failed. Cannot generate email.\nAttempts:\n  " + summary);
}

module.exports = {
  buildCandidates,
  buildJudgementPrompt,
  buildCorrectivePrompt,
  buildGenerationConfig,
  parseDecisions,
  judgeEvents,
  canonicalUrl,
  VERDICTS,
  TAGS,
};
