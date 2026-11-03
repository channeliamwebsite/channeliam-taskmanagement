import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { approvedLeaveByDate, formatDateRange, holidaysByDate, isIsoDate, summarizeClCredits, validateLeaveInput, type LeaveApplication } from "./leave.ts";

const app = (p: Partial<LeaveApplication>): LeaveApplication => ({
  id: "a", userId: "u", type: "CL", start: "2027-01-04", end: "2027-01-05", workingDays: 2, reason: "x",
  status: "APPROVED", decidedBy: null, decidedAt: null, rejectionReason: null, createdAt: "2027-01-01T00:00:00Z", ...p,
});

describe("validateLeaveInput", () => {
  const ok = { type: "CL", start: "2027-01-04", end: "2027-01-08", reason: "Family function" };
  it("accepts a valid application and trims the reason", () => {
    assert.deepEqual(validateLeaveInput({ ...ok, reason: "  Family function " }), { ok: true, value: { type: "CL", start: "2027-01-04", end: "2027-01-08", reason: "Family function" } });
  });
  it("rejects an unknown type, missing or impossible dates", () => {
    assert.equal(validateLeaveInput({ ...ok, type: "SICK" }).ok, false);
    assert.equal(validateLeaveInput({ ...ok, start: "" }).ok, false);
    assert.equal(validateLeaveInput({ ...ok, start: "2027-02-30" }).ok, false);
  });
  it("rejects an end before the start and a range across years", () => {
    assert.deepEqual(validateLeaveInput({ ...ok, end: "2027-01-03" }), { ok: false, error: "The end date is before the start date." });
    assert.equal(validateLeaveInput({ ...ok, start: "2026-12-31", end: "2027-01-01" }).ok, false);
  });
  it("requires a reason of 3 to 1000 characters", () => {
    assert.equal(validateLeaveInput({ ...ok, reason: " a " }).ok, false);
    assert.equal(validateLeaveInput({ ...ok, reason: "x".repeat(1001) }).ok, false);
  });
});

describe("dates", () => {
  it("validates calendar dates", () => {
    assert.equal(isIsoDate("2028-02-29"), true);
    assert.equal(isIsoDate("2027-02-29"), false);
    assert.equal(isIsoDate("2027-1-5"), false);
  });
  it("formats ranges", () => {
    assert.equal(formatDateRange("2027-01-04", "2027-01-04"), "4 Jan 2027");
    assert.equal(formatDateRange("2027-01-04", "2027-01-08"), "4 Jan – 8 Jan 2027");
  });
});

describe("calendar maps", () => {
  it("maps only approved leave, every date of the range", () => {
    const m = approvedLeaveByDate([
      app({ id: "1", type: "CL", start: "2027-01-30", end: "2027-02-01" }),
      app({ id: "2", type: "LWP", start: "2027-03-01", end: "2027-03-01", status: "PENDING" }),
      app({ id: "3", type: "WFH", start: "2027-03-02", end: "2027-03-02", status: "REJECTED" }),
    ]);
    assert.deepEqual([...m.entries()], [["2027-01-30", "CL"], ["2027-01-31", "CL"], ["2027-02-01", "CL"]]);
  });
  it("maps only active holidays", () => {
    const m = holidaysByDate([
      { id: "1", name: "Republic Day", date: "2027-01-26", description: null, isActive: true },
      { id: "2", name: "Cancelled", date: "2027-01-27", description: null, isActive: false },
    ]);
    assert.deepEqual([...m.entries()], [["2027-01-26", "Republic Day"]]);
  });
});

describe("CL credit summary", () => {
  it("counts available, used and expired credits and the next expiry", () => {
    const credits = [
      { month: "2027-01-01", expiresOn: "2027-03-31", status: "EXPIRED" as const },
      { month: "2027-02-01", expiresOn: "2027-04-30", status: "AVAILABLE" as const },
      { month: "2027-03-01", expiresOn: "2027-05-31", status: "USED" as const },
      { month: "2027-04-01", expiresOn: "2027-06-30", status: "AVAILABLE" as const },
    ];
    assert.deepEqual(summarizeClCredits(credits, "2027-04-10"), { available: 2, used: 1, expired: 1, expiringThisMonth: 1, nextExpiry: "2027-04-30" });
    assert.deepEqual(summarizeClCredits([], "2027-04-10"), { available: 0, used: 0, expired: 0, expiringThisMonth: 0, nextExpiry: null });
  });
});
