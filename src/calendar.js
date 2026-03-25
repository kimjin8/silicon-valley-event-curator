// ============================================================
// calendar.js — Google Calendar Integration
// ============================================================
//
// This module does two things:
//   1. Fetches your upcoming calendar events for the next 7 days
//   2. Filters them to only keep "busy" events (not tentative ones)
//
// WHY FILTER BUSY EVENTS?
// Google Calendar lets you mark events as "busy" or "free":
//   - "Busy" events block out your time (meetings, gym, dinner plans)
//   - "Free" events are informational only (reminders, notes)
//
// We only care about "busy" events because those represent real
// schedule conflicts that should prevent the AI from recommending
// events at the same time.
//
// TECHNICAL NOTE:
// Google Calendar API uses the field "transparency" to indicate this:
//   - transparency: "transparent" → the event is "free" (doesn't block time)
//   - transparency: undefined or "opaque" → the event is "busy"
// ============================================================

const { google } = require("googleapis");

/**
 * Fetch calendar events for the upcoming week.
 *
 * Calls the Google Calendar API to get all events between
 * "now" and "7 days from now" on your primary calendar.
 *
 * @param {google.auth.OAuth2} authClient - Authenticated Google client
 * @param {object} dateRange - Date range with timeMin and timeMax (ISO strings)
 * @returns {Promise<Array>} Array of calendar event objects
 */
async function getCalendarEvents(authClient, dateRange) {
  console.log("📅 Fetching Google Calendar events...");

  // Create a Calendar API client
  const calendar = google.calendar({ version: "v3", auth: authClient });

  try {
    const res = await calendar.events.list({
      calendarId: "primary", // "primary" = your main calendar
      timeMin: dateRange.timeMin,
      timeMax: dateRange.timeMax,
      singleEvents: true, // Expand recurring events into individual instances
      orderBy: "startTime", // Sort chronologically
    });

    const events = res.data.items || [];
    console.log("✅ Found " + events.length + " calendar events");
    return events;
  } catch (err) {
    // Calendar errors are non-fatal: the pipeline continues
    // without conflict checking rather than crashing entirely.
    console.error("❌ Calendar fetch failed:", err.message);
    console.warn("   ⚠ Continuing without calendar data (no conflict checking)");
    return [];
  }
}

/**
 * Filter calendar events to only keep "busy" ones.
 *
 * Removes events marked as "free" (transparency: "transparent"),
 * keeping only events that actually block out your time.
 *
 * Also strips each event down to just the essential fields needed
 * for the AI curation step (to minimize token usage).
 *
 * @param {Array} events - Raw calendar events from Google API
 * @returns {Array} Filtered array of busy events with essential fields only
 */
function filterBusyEvents(events) {
  // Safety check: if events isn't an array, return empty
  if (!Array.isArray(events)) return [];

  // Filter: keep events that are NOT marked as "transparent" (free)
  const busy = events.filter(
    (event) => event.transparency !== "transparent"
  );

  console.log("📅 " + busy.length + " busy events after filtering");

  // Return only the fields the AI needs (saves tokens):
  //   - summary: event name (e.g., "Team standup")
  //   - start/end: when it happens
  //   - location: where it happens (if specified)
  return busy.map((e) => ({
    summary: e.summary,
    start: e.start,
    end: e.end,
    location: e.location || null,
  }));
}

module.exports = { getCalendarEvents, filterBusyEvents };
