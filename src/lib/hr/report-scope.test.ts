import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveReportScope } from "./report-scope.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = "2027-02";

describe("report scope", () => {
  it("individuals and admins always get their own report only", () => {
    for (const role of ["INDIVIDUAL", "ADMIN"] as const) {
      const scope = resolveReportScope({ userId: ME, role }, { month: "2027-01", employee: OTHER, department: "Sales" }, NOW);
      assert.deepEqual(scope, { month: "2027-01", userId: ME, department: null, companyWide: false });
      // No filter at all still means "me", never company-wide.
      assert.equal(resolveReportScope({ userId: ME, role }, {}, NOW).userId, ME);
    }
  });

  it("super admins get company-wide exports, optionally filtered", () => {
    const sa = { userId: ME, role: "SUPER_ADMIN" } as const;
    assert.deepEqual(resolveReportScope(sa, {}, NOW), { month: NOW, userId: null, department: null, companyWide: true });
    assert.deepEqual(resolveReportScope(sa, { employee: OTHER }, NOW), { month: NOW, userId: OTHER, department: null, companyWide: false });
    assert.equal(resolveReportScope(sa, { department: " Sales " }, NOW).department, "Sales");
    assert.equal(resolveReportScope(sa, { employee: "not-a-uuid" }, NOW).userId, null);
  });

  it("parses month and year, falling back to the current month", () => {
    const sa = { userId: ME, role: "SUPER_ADMIN" } as const;
    assert.equal(resolveReportScope(sa, { month: "3", year: "2026" }, NOW).month, "2026-03");
    assert.equal(resolveReportScope(sa, { month: "12", year: "2026" }, NOW).month, "2026-12");
    assert.equal(resolveReportScope(sa, { month: "2027-03" }, NOW).month, "2027-03");
    for (const month of ["2027-04", "13", "2027-13", "abc", "1999-12"]) assert.equal(resolveReportScope(sa, { month, year: "2026" }, NOW).month, NOW);
    assert.equal(resolveReportScope(sa, { month: "1", year: "2027" }, "2026-12").month, "2027-01");
  });
});
