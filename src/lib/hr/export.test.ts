import assert from "node:assert/strict";
import { describe, it } from "node:test";

import ExcelJS from "exceljs";

import { DEFAULT_WORK_POLICY } from "../attendance.ts";
import { buildAttendanceWorkbook, type ExportInput } from "./export.ts";
import { employeeMonth, monthDates } from "./report.ts";

// February 2027: Sundays 7, 14, 21, 28; holiday on Monday 15; CL on the 2nd.
const dates = monthDates("2027-02-01", "2027-02-28");
const sessions = [
  { id: "s1", workspaceId: "w", workDate: "2027-02-01", checkInAt: "2027-02-01T03:30:00Z", checkOutAt: "2027-02-01T12:30:00Z", breaks: [] },
];
const month = employeeMonth({
  dates, sessions, leave: new Map([["2027-02-02", "CL" as const]]), holidays: new Map([["2027-02-15", "Festival"]]),
  weeklyOffDays: [0], policy: DEFAULT_WORK_POLICY, today: "2027-03-01", joined: "2026-01-01",
});
const input: ExportInput = {
  month: "2027-02",
  dates,
  timeZone: "Asia/Kolkata",
  reports: [{
    employee: { userId: "u1", employeeCode: "CH-0001", name: "Asha", email: "asha@example.test", department: "Ops", designation: "Lead", joiningDate: "2026-01-01", employmentStatus: "ACTIVE", employmentType: "FULL_TIME" },
    ...month,
    applications: [{ id: "a1", userId: "u1", type: "CL", start: "2027-02-02", end: "2027-02-02", workingDays: 1, reason: "Family", status: "APPROVED", decidedBy: "sa", decidedAt: "2027-01-20T10:00:00Z", rejectionReason: null, createdAt: "2027-01-19T10:00:00Z" }],
  }],
  clBalances: new Map([["u1", { allowance: 12, approved: 3, pending: 1, available: 2 }]]),
  names: new Map([["sa", "Super Admin"]]),
};

async function load() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildAttendanceWorkbook(input)) as unknown as ExcelJS.Buffer);
  return wb;
}

function cells(ws: ExcelJS.Worksheet, row: number) {
  const head = (ws.getRow(1).values as unknown[]).slice(1);
  const values = (ws.getRow(row).values as unknown[]).slice(1);
  return (name: string) => values[head.indexOf(name)];
}

describe("Excel export", () => {
  it("builds the four sheets; holidays and Sundays are never absences", async () => {
    const wb = await load();
    assert.deepEqual(wb.worksheets.map((w) => w.name), ["Monthly Attendance", "Daily Attendance Details", "Leave Summary", "Employee Summary"]);

    const col = cells(wb.getWorksheet("Monthly Attendance")!, 2);
    assert.equal(col("Employee ID"), "CH-0001");
    assert.equal(col("01"), "P");
    assert.equal(col("02"), "CL");
    assert.equal(col("03"), "A");
    assert.equal(col("07"), "WO");
    assert.equal(col("15"), "H");
    assert.equal(col("Present"), 1);
    assert.equal(col("CL"), 1);
    assert.equal(col("Weekly offs"), 4);
    assert.equal(col("Public holidays"), 1);
    assert.equal(col("Absent"), 28 - 4 - 1 - 1 - 1);
    assert.equal(col("Net working hours"), 9);

    const daily = wb.getWorksheet("Daily Attendance Details")!;
    assert.equal(daily.rowCount, 1 + 28);
    assert.equal(cells(daily, 16)("Attendance status"), "Holiday · Festival");

    const leave = wb.getWorksheet("Leave Summary")!;
    assert.deepEqual((leave.getRow(2).values as unknown[]).slice(1), ["CH-0001", "Asha", "Casual Leave", "2027-02-02", "2027-02-02", 1, "Approved", "Super Admin", "2027-01-20"]);

    const summary = cells(wb.getWorksheet("Employee Summary")!, 2);
    assert.equal(summary("CL credited (year)"), 12);
    assert.equal(summary("CL used (year)"), 3);
    assert.equal(summary("CL available (today)"), 2);
  });

  it("contains only the employees it is given and no identity or contact columns", async () => {
    const wb = await load();
    assert.equal(wb.getWorksheet("Employee Summary")!.rowCount, 2);
    for (const ws of wb.worksheets) {
      const head = JSON.stringify(ws.getRow(1).values).toLowerCase();
      for (const banned of ["pan", "aadhaar", "phone", "address", "birth"]) assert.ok(!head.includes(banned), `${ws.name}: ${banned}`);
    }
  });
});
