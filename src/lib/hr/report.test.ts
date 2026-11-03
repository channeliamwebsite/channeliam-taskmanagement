import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_WORK_POLICY, type AttendanceSession } from "../attendance.ts";
import type { LeaveType } from "./leave.ts";
import { dashboardCounts, dashboardStatus, employeeMonth, hours, monthDates } from "./report.ts";

// February 2027: Mon 1 ... Sun 28. Sundays: 7, 14, 21, 28.
const dates = monthDates("2027-02-01", "2027-02-28");
const day = (date: string, extra: Partial<AttendanceSession> = {}): AttendanceSession => ({
  id: date, workspaceId: "w", workDate: date,
  checkInAt: `${date}T03:30:00Z`, checkOutAt: `${date}T12:30:00Z`, // 09:00-18:00 IST
  breaks: [{ id: `${date}-b`, sessionId: date, startedAt: `${date}T07:30:00Z`, endedAt: `${date}T08:15:00Z` }],
  ...extra,
});

function run(opts: { sessions?: AttendanceSession[]; leave?: [string, LeaveType][]; holidays?: [string, string][]; today?: string; joined?: string | null }) {
  return employeeMonth({
    dates,
    sessions: opts.sessions ?? [],
    leave: new Map(opts.leave ?? []),
    holidays: new Map(opts.holidays ?? []),
    weeklyOffDays: [0],
    policy: DEFAULT_WORK_POLICY,
    today: opts.today ?? "2027-03-15",
    joined: opts.joined === undefined ? "2026-01-01" : opts.joined,
  });
}

describe("monthly totals", () => {
  it("Sundays and holidays are never absences", () => {
    const { totals, days } = run({ holidays: [["2027-02-15", "Company day"]] });
    assert.equal(totals.weeklyOffs, 4);
    assert.equal(totals.holidays, 1);
    assert.equal(totals.absent, 28 - 4 - 1);
    assert.equal(days.find((d) => d.date === "2027-02-07")!.status, "WEEKLY_OFF");
    assert.equal(days.find((d) => d.date === "2027-02-15")!.status, "HOLIDAY");
  });

  it("counts present days, leave and WFH separately, with hours", () => {
    const sessions = ["2027-02-01", "2027-02-02", "2027-02-03"].map((d) => day(d));
    const { totals, days } = run({
      sessions,
      leave: [["2027-02-04", "CL"], ["2027-02-05", "LWP"], ["2027-02-06", "WFH"], ["2027-02-03", "WFH"], ["2027-02-07", "CL"]],
    });
    assert.equal(totals.present, 3);
    assert.equal(totals.cl, 1, "a Sunday inside a CL range is a weekly off, not CL");
    assert.equal(totals.lwp, 1);
    assert.equal(totals.wfh, 2, "WFH counts whether or not the employee also checked in");
    assert.equal(totals.netMinutes, 3 * 495);
    assert.equal(totals.breakMinutes, 3 * 45);
    assert.equal(days.find((d) => d.date === "2027-02-03")!.status, "PRESENT");
    assert.equal(totals.absent, 28 - 4 - 3 - 3, "every other working day is absent");
  });

  it("does not count today or the future as absent", () => {
    const { totals, days } = run({ today: "2027-02-10" });
    assert.equal(days.find((d) => d.date === "2027-02-10")!.status, "UPCOMING");
    assert.equal(days.find((d) => d.date === "2027-02-20")!.status, "UPCOMING");
    assert.equal(totals.absent, 8, "Mon 1 - Tue 9 Feb minus Sunday 7");
  });

  it("does not count days before joining as absent", () => {
    const { totals, days } = run({ joined: "2027-02-15" });
    assert.equal(days.find((d) => d.date === "2027-02-10")!.status, "NOT_JOINED");
    assert.equal(totals.absent, 12, "15-28 Feb minus Sundays 21 and 28");
  });

  it("flags a missing check-out as present but without hours", () => {
    const { totals, days } = run({ sessions: [day("2027-02-01", { checkOutAt: null, breaks: [] })] });
    assert.equal(days[0]!.status, "MISSING_CHECKOUT");
    assert.equal(totals.missingCheckout, 1);
    assert.equal(totals.present, 1);
    assert.equal(totals.netMinutes, 0);
  });

  it("converts minutes to decimal hours", () => {
    assert.equal(hours(495), 8.25);
    assert.equal(hours(0), 0);
  });
});

describe("super admin dashboard status", () => {
  const today = "2027-02-10"; // Wednesday
  const one = (sessions: AttendanceSession[], leave: [string, LeaveType][] = [], date = today, holidays: [string, string][] = []) =>
    employeeMonth({
      dates: [date], sessions, leave: new Map(leave), holidays: new Map(holidays), weeklyOffDays: [0],
      policy: DEFAULT_WORK_POLICY, today, joined: "2026-01-01", now: new Date(`${today}T08:00:00Z`),
    }).days[0];

  it("splits working, on break, checked out, WFH, leave and not checked in", () => {
    const open = day(today, { checkOutAt: null, breaks: [] });
    const onBreak = day(today, { checkOutAt: null, breaks: [{ id: "b", sessionId: today, startedAt: `${today}T07:45:00Z`, endedAt: null }] });
    const days = [
      one([open]),
      one([onBreak]),
      one([day(today)]),
      one([], [[today, "WFH"]]),
      one([open], [[today, "WFH"]]),
      one([], [[today, "CL"]]),
      one([]),
    ];
    assert.deepEqual(days.map(dashboardStatus), ["WORKING", "ON_BREAK", "CHECKED_OUT", "WFH", "WORKING", "ON_LEAVE", "NOT_CHECKED_IN"]);
    assert.deepEqual(dashboardCounts(days), { active: 7, present: 4, working: 2, onBreak: 1, wfh: 2, onLeave: 1, absent: 0, notCheckedIn: 1 });
  });

  it("past working days without attendance are absent; holidays and Sundays never are", () => {
    assert.equal(dashboardStatus(one([], [], "2027-02-09")), "ABSENT");
    assert.equal(dashboardStatus(one([], [], "2027-02-07")), "WEEKLY_OFF");
    assert.equal(dashboardStatus(one([], [], "2027-02-08", [["2027-02-08", "Festival"]])), "HOLIDAY");
    assert.equal(dashboardCounts([one([], [], "2027-02-07"), one([], [], "2027-02-08", [["2027-02-08", "Festival"]])]).absent, 0);
  });
});
