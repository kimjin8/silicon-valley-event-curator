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
  // Used in the email header (e.g., "Bay Area Tech Events").
  region: "San Francisco Bay Area",

  // ── Your Interests ─────────────────────────────────────────
  // The AI uses these lists to decide which events to include
  // or exclude from your weekly digest.
  interests: {
    // Events about these topics will be included.
    include: [
      "AI",
      "consumer hardware",
      "startups",
      "founders",
      "entrepreneurship",
      "product launches",
      "demo days",
      "consumer tech",
    ],

    // Events about these topics will be excluded, even if they
    // match something in your include list.
    exclude: [
      "Healthcare",
      "HR",
      "Finance",
      "AI infrastructure",
      "highly technical engineering (e.g. kernel development, inference optimization, CUDA programming)",
    ],
  },

  // ── Your Weekly Schedule ───────────────────────────────────
  // Controls which events are geographically reachable for you
  // on each part of the week, and which evenings to skip.
  schedule: {
    // "all-day" = available daytime + evening (e.g. full-time founder)
    // "evening-only" = available evenings only (e.g. has a day job)
    availability: "all-day",

    // On weekdays (Mon–Fri), events in this area are shortlisted.
    // Events in other cities (e.g. SF) on weekdays go to "Also On Your Radar".
    weekdayRegion: "South Bay",

    // On weekends (Sat–Sun), events in this area are also allowed.
    weekendRegion: "SF",

    // Evening events on these days are excluded entirely.
    // Use full day names: "Monday", "Tuesday", "Wednesday", etc.
    blockedEvenings: ["Wednesday"],
  },

  // ── Cost Preferences ───────────────────────────────────────
  cost: {
    // Events above this price (in USD) are excluded by default.
    maxPriceUSD: 50,

    // Events featuring any of these will bypass the price limit.
    // Use descriptive phrases the AI can match against event details.
    priceExceptions: [
      "top hardware founders",
      "prominent AI researchers",
      "tech executives",
      "intimate networking dinners",
      "premium specialty coffee tech events",
      "Q-Grader networking events",
    ],
  },
};
