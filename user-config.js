// ============================================================
// user-config.js — Your Personal Curation Preferences
// ============================================================
//
// This is the ONE FILE to edit when setting up this curator
// for yourself. Change the values below to match your own
// interests, schedule, and budget.
//
// Secrets (API keys, your email address) go in .env instead —
// see .env.example for that template.
// ============================================================

module.exports = {
  // ── Your Region ────────────────────────────────────────────
  // Shown in the email header (e.g., "Bay Area Tech Events").
  // Also used by the AI as context for what "local" means.
  region: "San Francisco Bay Area",

  // ── Your Interests ─────────────────────────────────────────
  // The AI uses these lists to decide which events to include
  // or exclude from your weekly digest. Be specific — the more
  // precise your lists, the better the curation.
  interests: {
    // Events about these topics will be included.
    include: [
      "AI",
      "startups",
      "founders",
      "entrepreneurship",
      "product launches",
      "demo days",
      "consumer tech",
      "hardware",
    ],

    // Events about these topics will be excluded, even if they
    // also match something in your include list.
    exclude: [
      "Healthcare",
      "HR tech",
      "Finance / fintech",
      "Highly technical deep dives (e.g. kernel development, CUDA programming)",
    ],
  },

  // ── Your Weekly Schedule ───────────────────────────────────
  // Controls which events the AI shortlists vs. puts "on your
  // radar," and which evenings to skip entirely.
  schedule: {
    // "all-day" = available daytime + evening (e.g. full-time founder)
    // "evening-only" = available evenings only (e.g. has a day job)
    availability: "all-day",

    // On weekdays (Mon–Fri), events in this area are shortlisted.
    // Events in other cities on weekdays go to "Also On Your Radar."
    // Example values: "South Bay", "East Bay", "Peninsula", "SF"
    weekdayRegion: "South Bay",

    // On weekends (Sat–Sun), events in this area are shortlisted normally.
    weekendRegion: "SF",

    // Evenings on these days are blocked — events starting after 4 PM
    // will not be shortlisted. Use full day names.
    // Example: ["Wednesday", "Friday"]
    // Leave empty to rely entirely on your Google Calendar busy events.
    blockedEvenings: [],
  },

  // ── Cost Preferences ───────────────────────────────────────
  cost: {
    // Events above this price (in USD) are excluded by default.
    maxPriceUSD: 50,

    // Events matching any of these descriptions bypass the price limit.
    // Write them as natural language phrases the AI can match against
    // event titles and descriptions.
    priceExceptions: [
      "prominent founders or investors as speakers",
      "exclusive invite-only dinners",
      "small-group mentorship or office hours",
    ],
  },
};
