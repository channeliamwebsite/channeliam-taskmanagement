import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  departmentProgress,
  employeeCounts,
  employeePerformance,
  inDateRange,
  formatClock,
  meetingOccurrences,
  projectProgress,
  statusCounts,
  todaysWork,
  type MeetingInput,
  type OverviewTask,
} from "./super-admin-overview.ts";

const TODAY = "2026-10-27";
const task = (o: Partial<OverviewTask> & Pick<OverviewTask, "id" | "status">): OverviewTask => ({
  scheduledDate: TODAY,
  dueDate: null,
  completedAt: null,
  updatedAt: "2026-10-27T05:00:00Z",
  projectId: "p1",
  subtaskTotal: 0,
  assignees: [],
  ...o,
});

describe("statusCounts / todaysWork", () => {
  const tasks = [
    task({ id: "a", status: "COMPLETED", completedAt: "2026-10-27T06:00:00Z" }),
    task({ id: "b", status: "IN_PROGRESS" }),
    task({ id: "c", status: "IN_REVIEW" }),
    task({ id: "d", status: "TODO", dueDate: "2026-10-20", scheduledDate: "2026-10-20" }),
    task({ id: "e", status: "BLOCKED", scheduledDate: "2026-11-02" }),
    task({ id: "f", status: "CANCELLED" }),
    task({ id: "parent", status: "IN_PROGRESS", subtaskTotal: 2 }),
    task({ id: "g", status: "COMPLETED", completedAt: "2026-10-01T06:00:00Z", scheduledDate: "2026-10-01" }),
  ];

  it("counts each piece of work once, excluding cancelled tasks and parents with subtasks", () => {
    assert.deepEqual(statusCounts(tasks, TODAY), { total: 6, completed: 2, inProgress: 2, pending: 1, blocked: 1, overdue: 1 });
  });

  it("counts today's work as open work due/scheduled/carried into today plus work completed today", () => {
    // b, c (today), d (carried forward), a (completed today); e is scheduled for a later day
    // (same rule as My Day), g was completed on another day.
    assert.deepEqual(todaysWork(tasks, TODAY, "Asia/Kolkata"), { planned: 4, completedToday: 1 });
  });
});

describe("employeeCounts", () => {
  it("counts active admins and individuals; super admins are not employees here", () => {
    assert.deepEqual(
      employeeCounts([
        { role: "SUPER_ADMIN", isActive: true },
        { role: "ADMIN", isActive: true },
        { role: "INDIVIDUAL", isActive: true },
        { role: "INDIVIDUAL", isActive: true },
        { role: "INDIVIDUAL", isActive: false },
      ]),
      { admins: 1, individuals: 2, inactive: 1 },
    );
  });
});

describe("projectProgress", () => {
  it("summarises each project from its own tasks", () => {
    const [p] = projectProgress(
      [{ id: "p1", name: "Website", clientId: "c1", clientName: "Acme", ownerName: "Alex", dueDate: "2026-11-30" }],
      [
        task({ id: "a", status: "COMPLETED", assignees: [{ userId: "u1", fullName: "Ivy", email: null }], updatedAt: "2026-10-26T00:00:00Z" }),
        task({ id: "b", status: "TODO", dueDate: "2026-10-25", assignees: [{ userId: "u2", fullName: "Raj", email: null }], updatedAt: "2026-10-27T09:00:00Z" }),
        task({ id: "c", status: "BLOCKED", dueDate: "2026-11-05", assignees: [{ userId: "u1", fullName: "Ivy", email: null }] }),
        task({ id: "x", status: "TODO", projectId: "other" }),
      ],
      TODAY,
    );
    assert.deepEqual(
      { total: p!.total, completed: p!.completed, pending: p!.pending, blocked: p!.blocked, overdue: p!.overdue },
      { total: 3, completed: 1, pending: 1, blocked: 1, overdue: 1 },
    );
    assert.deepEqual(p!.assignees, ["Ivy", "Raj"]);
    assert.equal(p!.nextDue, "2026-10-25");
    assert.equal(p!.lastUpdate, "2026-10-27T09:00:00Z");
  });

  it("keeps projects without tasks at zero instead of hiding or estimating them", () => {
    const [p] = projectProgress([{ id: "empty", name: "New", clientId: null, clientName: null, ownerName: null, dueDate: null }], [], TODAY);
    assert.equal(p!.total, 0);
    assert.equal(p!.nextDue, null);
  });
});

describe("meetingOccurrences", () => {
  const m = (o: Partial<MeetingInput> & Pick<MeetingInput, "id" | "kind">): MeetingInput => ({
    title: o.id,
    url: "https://meet.example.com",
    team: null,
    startsAt: null,
    meetingDate: null,
    isActive: true,
    ...o,
  });

  it("lists daily meetings on every day and one-off meetings on their date, morning first", () => {
    const occ = meetingOccurrences(
      [
        m({ id: "evening", kind: "EVENING", startsAt: "18:00:00" }),
        m({ id: "morning", kind: "MORNING", startsAt: "09:30:00" }),
        m({ id: "review", kind: "OTHER", meetingDate: "2026-10-28" }),
        m({ id: "off", kind: "MORNING", isActive: false }),
      ],
      [{ meetingLinkId: "morning", meetingDate: "2026-10-27", status: "HELD" }],
      ["2026-10-27", "2026-10-28"],
      TODAY,
    );
    assert.deepEqual(
      occ.map((o) => `${o.date} ${o.meeting.id} ${o.status}`),
      [
        "2026-10-27 morning HELD",
        "2026-10-27 evening SCHEDULED",
        "2026-10-28 morning SCHEDULED",
        "2026-10-28 evening SCHEDULED",
        "2026-10-28 review SCHEDULED",
      ],
    );
  });

  it("marks a past occurrence without a record as not recorded", () => {
    const [o] = meetingOccurrences([m({ id: "morning", kind: "MORNING" })], [], ["2026-10-26"], TODAY);
    assert.equal(o!.status, "NOT_RECORDED");
  });

  it("formats meeting times", () => {
    assert.equal(formatClock("09:30:00"), "9:30 AM");
    assert.equal(formatClock("18:05"), "6:05 PM");
    assert.equal(formatClock(null), null);
  });
});

describe("employeePerformance / departmentProgress", () => {
  const a = (userId: string) => ({ userId, fullName: null, email: null });
  const members = [
    { userId: "u1", fullName: "Asha", email: "a@x.test", role: "INDIVIDUAL" as const, isActive: true, team: "Design" },
    { userId: "u2", fullName: "Bala", email: "b@x.test", role: "ADMIN" as const, isActive: true, team: "Design" },
    { userId: "u3", fullName: null, email: "c@x.test", role: "INDIVIDUAL" as const, isActive: true, team: null },
    { userId: "off", fullName: "Gone", email: "g@x.test", role: "INDIVIDUAL" as const, isActive: false, team: "Design" },
    { userId: "sa", fullName: "Sam", email: "s@x.test", role: "SUPER_ADMIN" as const, isActive: true, team: null },
  ];
  const tasks = [
    task({ id: "t1", status: "COMPLETED", completedAt: "2026-10-20T06:00:00Z", assignees: [a("u1"), a("u2")] }),
    task({ id: "t2", status: "IN_PROGRESS", assignees: [a("u1")] }),
    task({ id: "t3", status: "TODO", dueDate: "2026-10-25", scheduledDate: null, assignees: [a("u1")] }),
    task({ id: "t4", status: "CANCELLED", assignees: [a("u1")] }),
    task({ id: "parent", status: "IN_PROGRESS", subtaskTotal: 2, assignees: [a("u1")] }),
    task({ id: "t5", status: "TODO", assignees: [a("u3")] }),
  ];

  it("counts each employee's work with the dashboard rules (parents and cancelled excluded)", () => {
    const rows = employeePerformance(tasks, members, TODAY, null, "Asia/Kolkata");
    assert.deepEqual(rows.map((r) => r.userId), ["u1", "u2", "u3"], "active admins and individuals only");
    const u1 = rows[0];
    assert.equal(u1.department, "Design");
    assert.deepEqual([u1.total, u1.completed, u1.inProgress, u1.pending, u1.overdue, u1.completionPercent], [3, 1, 1, 1, 1, 33]);
    assert.equal(rows[2].name, "c@x.test");
  });

  it("matches statusCounts for one employee's tasks", () => {
    const u1 = employeePerformance(tasks, members, TODAY, null, "Asia/Kolkata")[0];
    const direct = statusCounts(tasks.filter((t) => t.assignees.some((x) => x.userId === "u1")), TODAY);
    assert.equal(u1.total, direct.total);
    assert.equal(u1.overdue, direct.overdue);
  });

  it("limits to a date range by due, scheduled or completion date", () => {
    const range = { from: "2026-10-20", to: "2026-10-21" };
    assert.ok(inDateRange(tasks[0], range, "Asia/Kolkata"), "completed on the 20th");
    assert.ok(!inDateRange(tasks[1], range, "Asia/Kolkata"), "scheduled today, outside");
    const u1 = employeePerformance(tasks, members, TODAY, range, "Asia/Kolkata")[0];
    assert.deepEqual([u1.total, u1.completed], [1, 1]);
  });

  it("counts a shared task once per department", () => {
    const depts = departmentProgress(tasks, members, null, "Asia/Kolkata");
    assert.deepEqual(depts, [
      { department: "Design", employees: 2, total: 3, completed: 1, completionPercent: 33 },
      { department: "No department", employees: 1, total: 1, completed: 0, completionPercent: 0 },
    ]);
  });
});
