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
  STABLE_FALLBACK_MODEL,
  AI_REQUEST_TIMEOUT_MS,
} = require("./config");
const userConfig = require("../user-config");

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
  const blockedEveningsList = schedule.blockedEvenings.join(", ");
  const allowedEvenings = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    .filter((d) => !schedule.blockedEvenings.includes(d))
    .join(", ");
  const priceExceptionsList = cost.priceExceptions.join(", ");

  return `You are an event curator for a tech professional in the ${region}. You receive raw event data from 3 sources (Cerebral Valley, Luma SF, SF IRL) plus the user's Google Calendar (busy events only) for the upcoming week.

Your job is to filter and rank events, then output a beautifully formatted HTML email.

## INPUT DATA
${JSON.stringify(mergedData, null, 2)}

## FILTERING RULES

### Interest Filter
INCLUDE events about: ${includeList}.
EXCLUDE events about: ${excludeList}.

### Schedule Filter (Pacific Time)
The user's availability: ${schedule.availability === 'all-day' ? 'Available all day (daytime and evening)' : 'Available evenings only (has a day job)'}.
The user has a location/day preference:
- WEEKDAYS (Mon through Fri): PREFER ${schedule.weekdayRegion} events — shortlist these. ${schedule.weekendRegion}/San Francisco weekday events should NOT be shortlisted; instead, place them in "Also On Your Radar" with a "SF on Weekday" badge.
- WEEKENDS (Sat and Sun): ${schedule.weekendRegion}/San Francisco events are allowed and should be shortlisted normally.
- WEEKDAY EVENINGS: Only ${allowedEvenings} evenings. REJECT all ${blockedEveningsList} evening events entirely.
- Cross-reference with the user's Google Calendar busy events provided. EXCLUDE any event that conflicts with an existing busy calendar event (overlapping times).

Important: SF weekday events belong in "Also On Your Radar" (not shortlisted), but the user CAN attend them — highlight compelling ones prominently in that section.

### Cost Filter
- Include events under $${cost.maxPriceUSD}
- EXCEPTIONS (allow any price): Events featuring ${priceExceptionsList}
- Free events are always welcome

## OUTPUT FORMAT
Generate ONLY raw HTML content. Do NOT wrap in markdown code fences. Do NOT include any text before or after the HTML. Start your response directly with the opening div tag.

Generate a self-contained HTML email body (no html, head, or body tags needed, just the inner content). Style it cleanly and professionally with inline CSS.

## DESIGN SPECIFICATION (follow this design exactly)

### 1. Header Section
- Dark navy background (#1a1a2e) with rounded corners
- Subtitle "YOUR WEEKLY CURATOR" in light gray uppercase letter-spacing
- Main title "📅 ${region} Tech Events" in white, large bold font
- Date range below in coral/orange (#ff6b6b) (e.g., "Week of March 23 – 29, 2026")
- Preference reminder: "📍 Weekday preference: ${schedule.weekdayRegion} (SF on radar) | 🚫 No ${blockedEveningsList} evenings" in a semi-transparent pill

### 2. Note Section (if applicable)
- Warm amber background (#fff3cd) with left border accent
- "⚡ Note:" prefix in bold
- Brief context about the week's picks (e.g., why there are fewer picks this week)

### 3. Shortlisted Events Section
- Section header: "✅ SHORTLISTED FOR YOU (N EVENTS)" in uppercase with green checkmark
- Each event is a card with white background, subtle border, border-radius

### 4. Event Card Design (for each shortlisted event)
- **Date badge line**: Day + date in coral (#e74c3c) uppercase bold (e.g., "TUESDAY · MAR 24"), followed by cost badge ("FREE" in green background, or price)
- **Special badges** if applicable: "FREE + 🍺 Open Bar" in green when relevant
- **Event name**: Large bold text, linked to registration URL
- **Time and location line**: "⏰ 5:30 PM | 📍 Location Name" with a "South Bay ✅" or "SF" badge (pill-style)
- **Description**: 2-3 sentence summary
- **Tags row**: Colored pill badges for categories:
  - 🤖 AI (blue), 🚀 Startups (purple), 🎨 Product (orange), 👥 Founders (teal), 🔥 Free (green)
  - Include "Source: Luma SF" or "Source: Cerebral Valley" or "Source: SF IRL" at the end
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
- For each excluded event: 🔥 emoji + event name in bold + reason badge (e.g., "SF on Weekday" in red pill)
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
 * @returns {Promise<string>} Generated HTML email content
 * @throws {Error} If both primary and fallback models fail
 */
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
    { name: STABLE_FALLBACK_MODEL, label: "Gemini 2.5 Flash Lite (stable fallback)" },
  ];

  for (let i = 0; i < models.length; i++) {
    const { name, label } = models[i];

    try {
      console.log(`   🔄 Trying ${label}...`);

      // Build generation config — thinkingConfig is only for Gemini 3+ models
      const generationConfig = {
        temperature: 0.2,
        maxOutputTokens: 65536,
      };

      // Only add thinkingConfig for models that support it (Gemini 2.5+)
      if (name.startsWith("gemini-3") || name.startsWith("gemini-2.5")) {
        generationConfig.thinkingConfig = {
          thinkingBudget: 8192,
        };
      }

      // Get the model instance
      const model = genAI.getGenerativeModel({
        model: name,
        generationConfig,
      });

      // Send the prompt with a timeout so we fall back quickly
      // instead of hanging for 5+ minutes on an unresponsive model
      const result = await Promise.race([
        model.generateContent(prompt),
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

      // If the model stopped for any reason other than natural completion,
      // the HTML is likely truncated — fall back to the next model
      if (finishReason !== "STOP") {
        const reason = `Output truncated (finishReason: ${finishReason}, ${html.length} chars)`;
        console.error(`   ⚠ ${label}: ${reason}`);
        if (i === models.length - 1) {
          throw new Error("All AI models produced truncated output.\nLast: " + reason);
        }
        console.log("   ⚠ Falling back to next model...");
        continue;
      }

      console.log(`✅ AI curation complete (${html.length} chars of HTML)`);
      return html;
    } catch (err) {
      console.error(`   ❌ ${label} failed:`, err.message);

      // If this was the last model, throw the error
      if (i === models.length - 1) {
        throw new Error(
          "All AI models failed. Cannot generate email.\n" +
            "Last error: " +
            err.message
        );
      }

      // Otherwise, log and try the fallback
      console.log("   ⚠ Falling back to next model...");
    }
  }
}

module.exports = { curateEventsWithAI, buildCurationPrompt };
