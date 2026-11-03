import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_WORK_POLICY,
  addMonths,
  breakMinutes,
  expectedNetMinutes,
  formatClock,
  formatDuration,
  formatTime,
  monthGrid,
  monthRange,
  parseMonth,
  sessionMinutes,
  summarizeDay,
  weekDates,
  workSummary,
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

describe("working-hours policy (033)", () => {
  // 09:00 IST = 03:30Z
  const day = (breaks: { startedAt: string; endedAt: string | null }[], checkOutAt: string | null = "2026-10-27T12:30:00Z") =>
    session({ checkInAt: "2026-10-27T03:30:00Z", checkOutAt, breaks: breaks.map((b, i) => ({ id: `b${i}`, sessionId: "s", ...b })) });

  it("expects 8 h 15 m net from a 9 h day with a 45 min break allowance", () => {
    assert.equal(expectedNetMinutes(DEFAULT_WORK_POLICY), 495);
  });

  it("a full 9 h day with exactly 45 min of breaks meets the day", () => {
    const w = workSummary([day([{ startedAt: "2026-10-27T07:30:00Z", endedAt: "2026-10-27T08:15:00Z" }])]);
    assert.deepEqual(w, { elapsedMinutes: 540, breakMinutes: 45, netMinutes: 495, excessBreakMinutes: 0, remainingMinutes: 0, onBreak: false });
  });

  it("adds up several breaks and reports the excess over the allowance", () => {
    const w = workSummary([day([
      { startedAt: "2026-10-27T05:00:00Z", endedAt: "2026-10-27T05:20:00Z" },
      { startedAt: "2026-10-27T07:30:00Z", endedAt: "2026-10-27T08:15:00Z" },
    ])]);
    assert.equal(w.breakMinutes, 65);
    assert.equal(w.excessBreakMinutes, 20);
    assert.equal(w.netMinutes, 475);
    assert.equal(w.remainingMinutes, 20, "net time still owed to reach 8 h 15 m");
  });

  it("counts a running break up to now and reports being on break", () => {
    const now = new Date("2026-10-27T08:00:00Z");
    const w = workSummary([day([{ startedAt: "2026-10-27T07:30:00Z", endedAt: null }], null)], DEFAULT_WORK_POLICY, now);
    assert.equal(w.elapsedMinutes, 270);
    assert.equal(w.breakMinutes, 30);
    assert.equal(w.netMinutes, 240);
    assert.equal(w.remainingMinutes, 255);
    assert.equal(w.onBreak, true);
  });

  it("never counts break time outside the session (bad or manipulated data)", () => {
    const s = day([
      { startedAt: "2026-10-27T02:00:00Z", endedAt: "2026-10-27T04:00:00Z" }, // starts before check-in: 30 min inside
      { startedAt: "2026-10-27T12:00:00Z", endedAt: "2026-10-27T14:00:00Z" }, // runs past check-out: 30 min inside
      { startedAt: "2026-10-27T09:00:00Z", endedAt: "2026-10-27T08:00:00Z" }, // ends before it starts: ignored
    ]);
    assert.equal(breakMinutes(s), 60);
  });

  it("breaks can never exceed the time worked", () => {
    const s = day([{ startedAt: "2026-10-27T03:30:00Z", endedAt: "2026-10-27T12:30:00Z" }]);
    const w = workSummary([s]);
    assert.equal(w.breakMinutes, 540);
    assert.equal(w.netMinutes, 0);
  });

  it("a day summary carries the work summary; a missing check-out counts nothing", () => {
    const open = day([], null);
    const d = summarizeDay("2026-10-27", [open], "2026-10-28", new Date("2026-10-28T06:00:00Z"));
    assert.equal(d.status, "MISSING_CHECKOUT");
    assert.equal(d.work.netMinutes, 0);
    assert.equal(d.work.remainingMinutes, 495);
  });

  it("follows a different policy", () => {
    const w = workSummary([day([])], { scheduledMinutes: 480, breakAllowanceMinutes: 60 });
    assert.equal(w.remainingMinutes, 0);
    assert.equal(w.excessBreakMinutes, 0);
  });
});

describe("leave, holidays and weekly offs on the calendar (034)", () => {
  const ctx = {
    leave: new Map([["2027-01-05", "CL" as const], ["2027-01-06", "WFH" as const]]),
    holidays: new Map([["2027-01-26", "Republic Day"]]),
    weeklyOffDays: [0],
  };
  const today = "2027-02-01";
  it("shows approved leave, WFH, holidays and Sundays on days without attendance", () => {
    assert.equal(summarizeDay("2027-01-05", [], today, undefined, undefined, ctx).status, "CL");
    assert.equal(summarizeDay("2027-01-06", [], today, undefined, undefined, ctx).status, "WFH");
    const holiday = summarizeDay("2027-01-26", [], today, undefined, undefined, ctx);
    assert.equal(holiday.status, "HOLIDAY");
    assert.equal(holiday.holiday, "Republic Day");
    assert.equal(summarizeDay("2027-01-10", [], today, undefined, undefined, ctx).status, "WEEKLY_OFF");
    assert.equal(summarizeDay("2027-01-11", [], today, undefined, undefined, ctx).status, "NO_RECORD");
  });
  it("a real check-in always wins, and keeps the leave for reference", () => {
    const s = session({ checkInAt: "2027-01-06T03:30:00Z", checkOutAt: "2027-01-06T12:30:00Z", workDate: "2027-01-06" });
    const d = summarizeDay("2027-01-06", [s], today, undefined, undefined, ctx);
    assert.equal(d.status, "PRESENT");
    assert.equal(d.leave, "WFH");
  });
});

describe("holidays and weekly offs inside a leave range (034)", () => {
  // Approved CL Sat 9 Jan - Tue 12 Jan 2027 with a holiday on Mon 11 Jan.
  const ctx = {
    leave: new Map([["2027-01-09", "CL" as const], ["2027-01-10", "CL" as const], ["2027-01-11", "CL" as const], ["2027-01-12", "CL" as const]]),
    holidays: new Map([["2027-01-11", "Company day"]]),
    weeklyOffDays: [0],
  };
  const status = (d: string) => summarizeDay(d, [], "2027-02-01", undefined, undefined, ctx).status;
  it("a holiday inside the range is a holiday, not leave", () => assert.equal(status("2027-01-11"), "HOLIDAY"));
  it("a Sunday inside the range is a weekly off, not leave", () => assert.equal(status("2027-01-10"), "WEEKLY_OFF"));
  it("the other days are leave", () => {
    assert.equal(status("2027-01-09"), "CL");
    assert.equal(status("2027-01-12"), "CL");
  });
});
