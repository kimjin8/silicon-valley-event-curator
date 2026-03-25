// ============================================================
// calendar.test.js — Tests for Google Calendar filtering
// ============================================================
// Vitest globals (describe, it, expect) are available automatically

const { filterBusyEvents } = require("../src/calendar");

describe("filterBusyEvents", () => {
  it("should keep events without transparency field (default = busy)", () => {
    const events = [
      { summary: "Team Meeting", start: { dateTime: "2026-03-24T10:00:00" } },
    ];
    const result = filterBusyEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe("Team Meeting");
  });

  it("should keep events with transparency 'opaque' (busy)", () => {
    const events = [
      {
        summary: "Gym",
        transparency: "opaque",
        start: { dateTime: "2026-03-24T17:00:00" },
        end: { dateTime: "2026-03-24T18:00:00" },
      },
    ];
    const result = filterBusyEvents(events);
    expect(result).toHaveLength(1);
  });

  it("should EXCLUDE events with transparency 'transparent' (free)", () => {
    const events = [
      {
        summary: "Birthday reminder",
        transparency: "transparent",
        start: { date: "2026-03-25" },
      },
    ];
    const result = filterBusyEvents(events);
    expect(result).toHaveLength(0);
  });

  it("should handle mixed busy and free events", () => {
    const events = [
      { summary: "Real meeting", start: { dateTime: "2026-03-24T09:00:00" } },
      { summary: "FYI only", transparency: "transparent", start: { date: "2026-03-24" } },
      { summary: "Lunch", transparency: "opaque", start: { dateTime: "2026-03-24T12:00:00" } },
    ];
    const result = filterBusyEvents(events);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.summary)).toEqual(["Real meeting", "Lunch"]);
  });

  it("should return empty array for empty input", () => {
    expect(filterBusyEvents([])).toEqual([]);
  });

  it("should return empty array for non-array input", () => {
    expect(filterBusyEvents(null)).toEqual([]);
    expect(filterBusyEvents(undefined)).toEqual([]);
    expect(filterBusyEvents("string")).toEqual([]);
  });

  it("should only return essential fields (summary, start, end, location)", () => {
    const events = [
      {
        summary: "Test Event",
        start: { dateTime: "2026-03-24T10:00:00" },
        end: { dateTime: "2026-03-24T11:00:00" },
        location: "123 Main St",
        // These extra fields should be stripped:
        id: "abc123",
        creator: { email: "test@example.com" },
        htmlLink: "https://calendar.google.com/...",
        etag: "abcdef",
      },
    ];
    const result = filterBusyEvents(events);
    expect(result).toHaveLength(1);
    expect(Object.keys(result[0])).toEqual(["summary", "start", "end", "location"]);
  });

  it("should set location to null if not provided", () => {
    const events = [
      { summary: "Remote meeting", start: { dateTime: "2026-03-24T10:00:00" } },
    ];
    const result = filterBusyEvents(events);
    expect(result[0].location).toBeNull();
  });
});
