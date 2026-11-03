import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { companyTotals, startOfDayUtc, type WorkspaceOverview } from "./company-overview.ts";

describe("startOfDayUtc", () => {
  it("handles India (+05:30), Kathmandu (+05:45), New York and UTC", () => {
    assert.equal(startOfDayUtc("2026-10-30", "Asia/Kolkata"), "2026-10-29T18:30:00.000Z");
    assert.equal(startOfDayUtc("2026-10-30", "Asia/Kathmandu"), "2026-10-29T18:15:00.000Z");
    assert.equal(startOfDayUtc("2026-10-30", "America/New_York"), "2026-10-30T04:00:00.000Z");
    assert.equal(startOfDayUtc("2026-10-30", "UTC"), "2026-10-30T00:00:00.000Z");
  });
});

describe("companyTotals", () => {
  const row = (o: Partial<WorkspaceOverview>): WorkspaceOverview => ({
    workspaceId: "w", name: "W", today: "2026-10-30", employees: 0, openTasks: 0, overdueTasks: 0, blockedTasks: 0,
    completedToday: 0, morningPlans: 0, eveningReports: 0, ...o,
  });
  it("adds every figure across workspaces", () => {
    const t = companyTotals([row({ employees: 3, openTasks: 5, overdueTasks: 1, morningPlans: 2 }), row({ employees: 2, openTasks: 1, blockedTasks: 1, eveningReports: 2 })]);
    assert.deepEqual(t, { employees: 5, openTasks: 6, overdueTasks: 1, blockedTasks: 1, completedToday: 0, morningPlans: 2, eveningReports: 2 });
  });
  it("is all zeros with no workspaces", () => {
    assert.equal(companyTotals([]).openTasks, 0);
  });
});
