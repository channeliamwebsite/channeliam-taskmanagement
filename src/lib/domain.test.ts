import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PRIORITIES,
  PRIORITY_LABELS,
  addDaysISO,
  isOverdue,
  isPriority,
  isTaskStatus,
  isWorkingDay,
  nextWorkingDay,
  todayISO,
  weekdayOf,
} from "./domain.ts";

describe("todayISO (timezone-aware)", () => {
  // 2026-10-11T20:00:00Z is 2026-10-12 01:30 in India but still the 11th in UTC / New York.
  const instant = new Date("2026-10-11T20:00:00Z");

  it("defaults to Asia/Kolkata", () => {
    assert.equal(todayISO(instant), "2026-10-12");
  });

  it("respects an explicit workspace timezone", () => {
    assert.equal(todayISO(instant, "UTC"), "2026-10-11");
    assert.equal(todayISO(instant, "America/New_York"), "2026-10-11");
  });

  it("falls back to India for an invalid timezone instead of throwing", () => {
    assert.equal(todayISO(instant, "Not/A_Zone"), "2026-10-12");
  });
});

describe("date arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    assert.equal(addDaysISO("2026-10-31", 1), "2026-11-01");
    assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysISO("2026-03-01", -1), "2026-02-28");
  });

  it("computes weekdays and working days (Mon–Sat)", () => {
    assert.equal(weekdayOf("2026-10-12"), 1); // Monday
    assert.equal(isWorkingDay("2026-10-17"), true); // Saturday
    assert.equal(isWorkingDay("2026-10-18"), false); // Sunday
    assert.equal(nextWorkingDay("2026-10-18"), "2026-10-19");
    assert.equal(nextWorkingDay("2026-10-14"), "2026-10-14");
  });
});

describe("isOverdue", () => {
  it("flags only open tasks past their due date", () => {
    assert.equal(isOverdue("2026-10-11", "TODO", "2026-10-12"), true);
    assert.equal(isOverdue("2026-10-12", "TODO", "2026-10-12"), false);
    assert.equal(isOverdue("2026-10-11", "COMPLETED", "2026-10-12"), false);
    assert.equal(isOverdue("2026-10-11", "CANCELLED", "2026-10-12"), false);
    assert.equal(isOverdue(null, "TODO", "2026-10-12"), false);
  });
});

describe("enums and labels", () => {
  it("orders priorities P1→P4 with business labels", () => {
    assert.deepEqual(
      PRIORITIES.map((p) => PRIORITY_LABELS[p]),
      ["P1 Critical", "P2 High", "P3 Normal", "P4 Low"],
    );
  });

  it("validates enum input coming from forms and URLs", () => {
    assert.equal(isPriority("URGENT"), true);
    assert.equal(isPriority("P1"), false);
    assert.equal(isTaskStatus("IN_REVIEW"), true);
    assert.equal(isTaskStatus("in_review"), false);
    assert.equal(isTaskStatus(undefined), false);
  });
});
