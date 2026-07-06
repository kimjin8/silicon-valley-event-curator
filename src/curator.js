// ============================================================
// curator.js — AI-Powered Event Curation with Gemini
// ============================================================
//
// This is the "brain" of the program. It takes raw scraped event
// data + your calendar and sends it to Gemini AI with a detailed
// set of instructions (called a "prompt") that tells the AI to:
//
//   1. Filter events based on your interests
//   2. Filter events based on your schedule rules
//   3. Check for calendar conflicts
//   4. Rank the remaining events
//   5. Generate a beautifully formatted HTML email
//
// MODEL FALLBACK:
// If the primary model (Gemini 3 Flash Preview) fails due to
// rate limits, server errors, or timeouts, we automatically
// retry with the fallback model (Gemini 3.1 Flash Lite).
// Both models use the same API and format — only the model
// name changes.
//
// TOKEN OPTIMIZATION:
// Each "token" costs money (input: $0.50/million, output: $3.00/million).
// To keep costs low, we only send the AI the data it needs
// (not full web pages or all calendar fields).
// ============================================================

const { GoogleGenerativeAI } = require("@google/generative-ai");
const {
  GEMINI_API_KEY,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  AI_REQUEST_TIMEOUT_MS,
} = require("./config");
const userConfig = require("../user-config");
const { validateCurationOutput } = require("./validator");

/**
 * Build the curation prompt.
 *
 * This function creates the detailed instructions that tell the AI
 * exactly what to do with the event data. The prompt includes:
 * - The merged data from all sources
 * - Filtering rules (interests, schedule, cost)
 * - The exact HTML format to output
 *
 * @param {object} mergedData - Combined data from scrapers + calendar
 * @returns {string} The complete prompt text
 */
function buildCurationPrompt(mergedData) {
  const { region, interests, schedule, cost } = userConfig;

  const includeList = interests.include.join(", ");
  const excludeList = interests.exclude.join(", ");
  const priceExceptionsList = cost.priceExceptions.join(", ");

  // Pre-formatted PT labels — use these verbatim, never derive dates from raw timestamps.
  const todayPT = mergedData?.dateRange?.todayPT || "";
  const weekLabelPT = mergedData?.dateRange?.weekLabelPT || "";

  return `You are an event curator for a tech professional in the ${region}. You receive raw event data from 3 sources (Cerebral Valley, Luma SF, SF IRL) plus the user's Google Calendar (busy events only) for the upcoming week.

Your job is to filter and rank events, then output a beautifully formatted HTML email.

## TODAY (in Pacific Time)
${todayPT}

## WEEK LABEL FOR HEADER (use verbatim — do not recompute)
${weekLabelPT}

## INPUT DATA
${JSON.stringify(mergedData, null, 2)}

## FILTERING RULES

### Interest Filter
INCLUDE events about: ${includeList}.
EXCLUDE events about: ${excludeList}.

### Schedule Filter (Pacific Time)
The user's availability: ${schedule.availability === 'all-day' ? 'Available all day (daytime and evening)' : 'Available evenings only (has a day job)'}.
The user has a location/day preference:
- WEEKDAYS (Mon through Fri): ${schedule.weekdayRegion} is the DEFAULT. When ${schedule.weekdayRegion} events of comparable interest exist, prefer them. Shortlist a ${schedule.weekendRegion}/San Francisco weekday event ONLY when (a) it is an exceptionally strong interest match AND (b) there is no comparable ${schedule.weekdayRegion} alternative on the same day. Otherwise place ${schedule.weekendRegion} weekday events in "Also On Your Radar" with a "SF on Weekday" badge. Do NOT shortlist an all-SF lineup when ${schedule.weekdayRegion} options exist.
- WEEKENDS (Sat and Sun): ${schedule.weekendRegion}/San Francisco events are allowed and should be shortlisted normally.
- Cross-reference with the user's Google Calendar busy events provided. EXCLUDE any event that conflicts with an existing busy calendar event (overlapping times).

Important: a balanced shortlist that includes ${schedule.weekdayRegion} events is the goal. If the input contains qualifying ${schedule.weekdayRegion} events, surface at least one.

### Cost Filter
- Include events under $${cost.maxPriceUSD}
- EXCEPTIONS (allow any price): Events featuring ${priceExceptionsList}
- Free events are always welcome

## CRITICAL DATA ACCURACY RULES
- Each event has pre-computed fields: dayOfWeek, datePT, startTimePT, endTimePT, displayTime, and source. USE THESE EXACTLY AS PROVIDED.
- Do NOT compute day-of-week yourself — use the dayOfWeek field from the data.
- Do NOT convert timestamps from UTC — use the pre-computed PT fields.
- Do NOT guess the source — use the source field from each event ("Cerebral Valley", "Luma SF", or "SF IRL").
- For event time display, use the displayTime field as-is. It already handles overnight/multi-day events correctly (e.g., "Fri 7:00 PM – Sat 3:00 PM"). Do NOT recompose times yourself.
- CALENDAR FIDELITY: when describing the user's schedule (e.g., the Note section or Calendar heads-up), use the most SPECIFIC calendar event. If a travel event has a specific departure time (e.g., "Flight to NYC" Saturday 7:00 PM), describe departure as Saturday — do NOT infer departure from a multi-day all-day block (e.g., "Trip to NYC" starting Sunday). Multi-day all-day blocks describe presence at the destination, not the departure date.
- LOCATION SANITY: only shortlist or surface events physically located in the San Francisco Bay Area (San Francisco, Oakland, Berkeley, Palo Alto, Mountain View, Sunnyvale, San Jose, Stanford, Menlo Park, Redwood City, San Mateo, Cupertino, Santa Clara, Fremont, Hayward, etc.). If the location field shows a city outside the Bay Area (e.g., Reykjavik, NYC, LA, online-only with non-Bay-Area host), DROP the event entirely — do not put it in shortlist or radar. Bad upstream data is not the user's problem.

## OUTPUT FORMAT
Generate ONLY raw HTML content. Do NOT wrap in markdown code fences. Do NOT include any text before or after the HTML. Start your response directly with the opening div tag.

Generate a self-contained HTML email body (no html, head, or body tags needed, just the inner content). Style it cleanly and professionally with inline CSS.

## DESIGN SPECIFICATION (follow this design exactly)

### 1. Header Section
- Dark navy background (#1a1a2e) with rounded corners
- Subtitle "YOUR WEEKLY CURATOR" in light gray uppercase letter-spacing
- Main title "📅 ${region} Tech Events" in white, large bold font
- Date range below in coral/orange (#ff6b6b): use the format "Week of ${weekLabelPT}" — substitute the WEEK LABEL provided above EXACTLY, do not recompute or shift the dates
- Preference reminder: "📍 Weekday preference: ${schedule.weekdayRegion} (SF on radar)" in a semi-transparent pill

### 2. Note Section (if applicable)
- Warm amber background (#fff3cd) with left border accent
- "⚡ Note:" prefix in bold
- Brief context about the week's picks (e.g., why there are fewer picks this week)

### 3. Shortlisted Events Section
- Section header: "✅ SHORTLISTED FOR YOU (N EVENTS)" in uppercase with green checkmark
- Each event is a card with white background, subtle border, border-radius

### 4. Event Card Design (for each shortlisted event)
- **Date badge line**: Day + date in coral (#e74c3c) uppercase bold (e.g., "SATURDAY · APR 18"), followed by cost badge ("FREE" in green background, or price) with margin-left: 8px for spacing
- **IMPORTANT**: Use the event's dayOfWeek and datePT fields for the date badge — do NOT calculate the day name yourself
- **Special badges** if applicable: "FREE + 🍺 Open Bar" in green when relevant
- **Event name**: Large bold text, linked to registration URL
- **Time and location line**: "⏰ {displayTime} | 📍 Location Name" using the event's displayTime field exactly as provided, with a "${schedule.weekdayRegion} ✅" or "${schedule.weekendRegion}" badge (pill-style, margin-left: 8px) to indicate which region preference the event satisfies
- **Description**: 2-3 sentence summary
- **Tags row**: Colored pill badges for categories:
  - 🤖 AI (blue), 🚀 Startups (purple), 🎨 Product (orange), 👥 Founders (teal), 🔥 Free (green)
  - Include "Source: {source}" using each event's source field (e.g., "Source: Luma SF" or "Source: Cerebral Valley")
- **Register button**: Coral/orange (#e74c3c) rounded button with white text: "Register on Luma →" or "Register →"
  - IMPORTANT: The button MUST link to the specific event registration page, NOT to a general listing page. Use the individual event URLs from the Luma events data.

### 5. Calendar Heads-Up Section
- Light blue background (#d4edfc) with calendar emoji
- "📅 Calendar heads-up:" prefix in bold
- Friendly note about what's already on the user's calendar for the relevant days
- Mention specific calendar events by name and time

### 6. "Also On Your Radar" Section
- Header: "✨ ALSO ON YOUR RADAR" in uppercase with sparkle emoji
- Subtitle: "(Great interest match — excluded by schedule/location rules)"
- For each excluded event: Day + date in coral uppercase bold (e.g., "MONDAY · APR 20") + reason badge (e.g., "SF on Weekday" in red pill, margin-left: 8px)
- Below: date range, time, location, source info
- Brief note explaining why it would be a strong pick but was excluded

### 7. General Styling
- Font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
- Max-width: 600px, centered, with padding
- All styles must be INLINE (email clients don't support <style> tags)
- Use shadows and rounded corners for cards
- Make registration buttons prominent and inviting

If no events pass the filters, say so politely and suggest checking back next week.`;
}

/**
 * Call Gemini AI to curate events and generate the HTML email.
 *
 * Tries the primary model first. If it fails (rate limit, server
 * error, etc.), automatically falls back to the secondary model.
 *
 * @param {object} mergedData - Combined data from all sources
 * @returns {Promise<{html: string, prompt: string, modelUsed: string, finishReason: string, usage: object|null, attempts: Array}>}
 * @throws {Error} If both primary and fallback models fail
 */
// Build a corrective prompt that names the specific validation violations
// from a prior attempt, so the retry can fix them rather than blindly
// regenerating. The original prompt is still appended verbatim.
function buildCorrectivePrompt(originalPrompt, validation) {
  return (
    `Your previous response was rejected by automatic validation.\n` +
    `Reasons (you MUST fix all of these):\n` +
    validation.reasons.map((r) => `- ${r}`).join("\n") +
    `\n\nCommon causes:\n` +
    `- Shortlisting an event whose start time overlaps a busy calendar event\n` +
    `- Surfacing an event whose location is outside the Bay Area\n` +
    `- Using a placeholder href="#" instead of the real registration URL\n` +
    `- Surfacing too few events from a large input (must surface multiple)\n` +
    `- All-${userConfig.schedule.weekendRegion} shortlist when ${userConfig.schedule.weekdayRegion} alternatives exist\n\n` +
    `Regenerate the full HTML email per the original spec below, fixing every issue.\n` +
    `=== ORIGINAL PROMPT ===\n${originalPrompt}`
  );
}

// Build the per-model generation config. Thinking must be capped so it can't
// consume the entire maxOutputTokens budget and truncate the HTML. Gemini 3
// silently ignores thinkingBudget on hard prompts (observed ~63k thinking
// tokens against an 8192 budget → MAX_TOKENS truncation); its thinkingLevel
// control IS honored (~4k thinking tokens at "low"). Gemini 2.5 predates
// thinkingLevel and still uses thinkingBudget.
function buildGenerationConfig(name) {
  const generationConfig = {
    temperature: 0.2,
    maxOutputTokens: 65536,
  };

  if (name.startsWith("gemini-3")) {
    generationConfig.thinkingConfig = { thinkingLevel: "low" };
  } else if (name.startsWith("gemini-2.5")) {
    generationConfig.thinkingConfig = { thinkingBudget: 8192 };
  }

  return generationConfig;
}

async function curateEventsWithAI(mergedData) {
  console.log("🤖 Curating events with Gemini AI...");

  // Initialize the Gemini API client
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

  // Build the prompt (same prompt for both models)
  const prompt = buildCurationPrompt(mergedData);

  // Try primary model first, then fallback
  const models = [
    { name: PRIMARY_MODEL, label: "Gemini 3 Flash Preview (primary)" },
    { name: FALLBACK_MODEL, label: "Gemini 3.1 Flash Lite (fallback)" },
  ];

  const attempts = [];

  for (let i = 0; i < models.length; i++) {
    const { name, label } = models[i];

    // Each model gets up to 2 attempts: original prompt, then a corrective
    // retry that names the validation violations from the first attempt.
    let lastValidation = null;

    for (let attemptNum = 0; attemptNum < 2; attemptNum++) {
      const isCorrective = attemptNum > 0;
      const promptToSend = isCorrective
        ? buildCorrectivePrompt(prompt, lastValidation)
        : prompt;
      const attemptLabel = isCorrective ? `${label} [retry w/ feedback]` : label;

    try {
      console.log(`   🔄 Trying ${attemptLabel}...`);

      const generationConfig = buildGenerationConfig(name);

      // Get the model instance
      const model = genAI.getGenerativeModel({
        model: name,
        generationConfig,
      });

      // Send the prompt with a timeout so we fall back quickly
      // instead of hanging for 5+ minutes on an unresponsive model
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

      // Clean up: strip markdown code fences if the AI accidentally wraps
      // the HTML in ```html ... ``` (some models do this despite instructions)
      const html = text
        .replace(/^```html\n?/i, "")
        .replace(/\n?```$/i, "")
        .trim();

      // Log token usage and finish reason for debugging
      const usage = response.usageMetadata;
      const candidate = response.candidates && response.candidates[0];
      const finishReason = candidate ? candidate.finishReason : "UNKNOWN";

      if (usage) {
        console.log(
          `   📊 Tokens — input: ${usage.promptTokenCount}, output: ${usage.candidatesTokenCount}, thinking: ${usage.thoughtsTokenCount || 0}, finish: ${finishReason}`
        );
      }

      // Truncation is unlikely to fix itself with a corrective retry on the
      // same model — advance straight to the next model.
      if (finishReason !== "STOP") {
        const reason = `Output truncated (finishReason: ${finishReason}, ${html.length} chars)`;
        console.error(`   ⚠ ${attemptLabel}: ${reason}`);
        attempts.push({ model: name, label: attemptLabel, outcome: "truncated", finishReason, usage: usage || null });
        if (i === models.length - 1 && isCorrective) {
          throw new Error("All AI models produced truncated output.\nLast: " + reason);
        }
        break; // exit attempt loop, advance to next model
      }

      // Validate: catch clean-STOP-but-garbage outputs (hallucinated URLs,
      // dropped events, blocked-evening shortlists, calendar conflicts).
      const validation = validateCurationOutput(html, mergedData);
      if (!validation.ok) {
        const reason = `Validation failed: ${validation.reasons.join("; ")}`;
        console.error(`   ⚠ ${attemptLabel}: ${reason}`);
        console.error(`     stats:`, validation.stats);
        attempts.push({
          model: name,
          label: attemptLabel,
          outcome: "invalid",
          reasons: validation.reasons,
          stats: validation.stats,
          finishReason,
          usage: usage || null,
        });
        lastValidation = validation;
        // First failure on this model: do a corrective retry naming the violations.
        if (!isCorrective) {
          console.log("   🔁 Retrying same model with corrective feedback...");
          continue; // next iteration of inner attempt loop
        }
        // Already retried with feedback — advance to next model.
        if (i === models.length - 1) {
          throw new Error("All AI models produced invalid output.\nLast: " + reason);
        }
        console.log("   ⚠ Falling back to next model...");
        break;
      }

      console.log(`✅ AI curation complete (${html.length} chars of HTML)`);
      console.log(`   📋 Validation passed:`, validation.stats);
      attempts.push({
        model: name,
        label: attemptLabel,
        outcome: "success",
        finishReason,
        usage: usage || null,
        stats: validation.stats,
      });
      return { html, prompt: promptToSend, modelUsed: name, finishReason, usage: usage || null, attempts };
    } catch (err) {
      console.error(`   ❌ ${attemptLabel} failed:`, err.message);
      attempts.push({ model: name, label: attemptLabel, outcome: "error", error: err.message });

      if (i === models.length - 1 && isCorrective) {
        throw new Error(
          "All AI models failed. Cannot generate email.\n" +
            "Last error: " +
            err.message
        );
      }
      // API errors (timeout, 503) — don't waste a corrective retry on the
      // same model; advance straight to the next.
      break;
    }
    } // end inner attempt loop

    if (i < models.length - 1) {
      console.log("   ⚠ Falling back to next model...");
    }
  }

  // Outer model loop exhausted without a successful return. Compose a
  // diagnostic from the recorded attempts so the operator can see what
  // happened on each model.
  const tail = attempts.slice(-models.length * 2);
  const summary = tail
    .map((a) => `${a.label}: ${a.outcome}${a.error ? ` (${a.error})` : ""}${a.reasons ? ` — ${a.reasons.join("; ")}` : ""}`)
    .join("\n  ");
  throw new Error(
    "All AI models failed. Cannot generate email.\nAttempts:\n  " + summary
  );
}

module.exports = { curateEventsWithAI, buildCurationPrompt, buildCorrectivePrompt, buildGenerationConfig };
