import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addMonths,
  formatClock,
  formatDuration,
  formatTime,
  monthGrid,
  monthRange,
  parseMonth,
  sessionMinutes,
  summarizeDay,
  weekDates,
  type AttendanceSession,
} from "./attendance.ts";

const tz = "Asia/Kolkata";

function session(partial: Partial<AttendanceSession> & { checkInAt: string }): AttendanceSession {
  return { id: partial.checkInAt, workspaceId: "w", workDate: "2026-10-27", checkOutAt: null, ...partial };
}

describe("sessionMinutes", () => {
  it("counts whole minutes of a closed session", () => {
    assert.equal(sessionMinutes(session({ checkInAt: "2026-10-27T03:30:00Z", checkOutAt: "2026-10-27T12:15:59Z" })), 525);
  });
  it("counts an open session up to now", () => {
    const now = new Date("2026-10-27T05:00:00Z");
    assert.equal(sessionMinutes(session({ checkInAt: "2026-10-27T03:30:00Z" }), now), 90);
  });
  it("never goes negative (clock skew or bad data)", () => {
    const now = new Date("2026-10-27T03:00:00Z");
    assert.equal(sessionMinutes(session({ checkInAt: "2026-10-27T03:30:00Z" }), now), 0);
    assert.equal(sessionMinutes(session({ checkInAt: "garbage" }), now), 0);
  });
});

describe("summarizeDay", () => {
  const now = new Date("2026-10-27T10:00:00Z");
  it("is 'no record' without sessions", () => {
    const day = summarizeDay("2026-10-27", [], "2026-10-27", now);
    assert.equal(day.status, "NO_RECORD");
    assert.equal(day.minutes, 0);
    assert.equal(day.firstCheckIn, null);
  });
  it("is 'checked in' today while a session is open, counting live time", () => {
    const day = summarizeDay("2026-10-27", [session({ checkInAt: "2026-10-27T04:00:00Z" })], "2026-10-27", now);
    assert.equal(day.status, "CHECKED_IN");
    assert.equal(day.minutes, 360);
    assert.equal(day.lastCheckOut, null);
  });
  it("adds up several sessions in a day and reports first in / last out", () => {
    const sessions = [
      session({ checkInAt: "2026-10-27T08:00:00Z", checkOutAt: "2026-10-27T09:00:00Z" }),
      session({ checkInAt: "2026-10-27T03:30:00Z", checkOutAt: "2026-10-27T07:30:00Z" }),
    ];
    const day = summarizeDay("2026-10-27", sessions, "2026-10-28", now);
    assert.equal(day.status, "PRESENT");
    assert.equal(day.minutes, 300);
    assert.equal(day.firstCheckIn, "2026-10-27T03:30:00Z");
    assert.equal(day.lastCheckOut, "2026-10-27T09:00:00Z");
  });
  it("flags a session still open after its day as a missing check-out and does not count it", () => {
    const sessions = [
      session({ checkInAt: "2026-10-26T03:30:00Z", workDate: "2026-10-26", checkOutAt: "2026-10-26T05:30:00Z" }),
      session({ checkInAt: "2026-10-26T06:00:00Z", workDate: "2026-10-26" }),
    ];
    const day = summarizeDay("2026-10-26", sessions, "2026-10-27", now);
    assert.equal(day.status, "MISSING_CHECKOUT");
    assert.equal(day.minutes, 120);
    assert.equal(day.lastCheckOut, null);
  });
  it("only uses sessions of that local date", () => {
    const sessions = [session({ checkInAt: "2026-10-26T03:30:00Z", workDate: "2026-10-26", checkOutAt: "2026-10-26T05:30:00Z" })];
    assert.equal(summarizeDay("2026-10-27", sessions, "2026-10-27", now).status, "NO_RECORD");
  });
});

describe("timezone boundaries", () => {
  it("shows times in India time", () => {
    // 18:45 UTC on the 26th is 00:15 on the 27th in India.
    assert.equal(formatTime("2026-10-26T18:45:00Z", tz), "12:15 AM");
    assert.equal(formatTime("2026-10-27T03:35:00Z", tz), "9:05 AM");
    assert.equal(formatTime(null, tz), "—");
  });
  it("falls back to India time for an invalid timezone", () => {
    assert.equal(formatTime("2026-10-27T03:35:00Z", "Not/AZone"), "9:05 AM");
  });
});

describe("formatting", () => {
  it("formats durations and the live clock", () => {
    assert.equal(formatDuration(425), "7h 05m");
    assert.equal(formatDuration(-3), "0h 00m");
    assert.equal(formatClock(25509), "07:05:09");
    assert.equal(formatClock(-1), "00:00:00");
  });
});

describe("weeks and months", () => {
  it("weeks run Monday to Sunday", () => {
    assert.deepEqual(weekDates("2026-10-29"), [
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
    assert.equal(weekDates("2026-11-01")[0], "2026-10-26");
  });
  it("parses and steps months", () => {
    assert.equal(parseMonth("2026-02", "2026-10-29"), "2026-02");
    assert.equal(parseMonth("2026-13", "2026-10-29"), "2026-10");
    assert.equal(parseMonth(undefined, "2026-10-29"), "2026-10");
    assert.equal(addMonths("2026-01", -1), "2025-12");
    assert.equal(addMonths("2026-12", 1), "2027-01");
    assert.deepEqual(monthRange("2028-02"), { first: "2028-02-01", last: "2028-02-29" });
  });
  it("builds a Monday-first month grid", () => {
    const grid = monthGrid("2026-10");
    assert.equal(grid.length, 5);
    assert.deepEqual(grid[0], [null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    assert.equal(grid.at(-1)!.at(-1), null);
    assert.equal(grid.flat().filter(Boolean).length, 31);
  });
});
