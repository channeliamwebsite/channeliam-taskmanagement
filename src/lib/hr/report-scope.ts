// Who a monthly report covers. Pure: the export route and report pages pass
// the caller's role and id with the raw query values. RLS enforces the same
// boundary in the database; this keeps ordinary users from even asking.

export type ReportScope = {
  /** "YYYY-MM". */
  month: string;
  /** Single employee, or null for everyone the caller may see. */
  userId: string | null;
  department: string | null;
  companyWide: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Month from `month` ("YYYY-MM", or "1"-"12" with `year`); the current
 * month when missing or invalid, and never later than next month.
 * Super admins may filter by employee and department; everyone else always
 * gets their own report, whatever they pass.
 */
export function resolveReportScope(
  caller: { userId: string; role: "SUPER_ADMIN" | "ADMIN" | "INDIVIDUAL" },
  params: { month?: unknown; year?: unknown; employee?: unknown; department?: unknown },
  currentMonth: string,
): ReportScope {
  const month = parseMonthParam(params.month, params.year, currentMonth);
  if (caller.role !== "SUPER_ADMIN") return { month, userId: caller.userId, department: null, companyWide: false };
  const userId = typeof params.employee === "string" && UUID.test(params.employee) ? params.employee : null;
  const department = typeof params.department === "string" && params.department.trim() ? params.department.trim().slice(0, 100) : null;
  return { month, userId, department, companyWide: !userId };
}

function parseMonthParam(month: unknown, year: unknown, currentMonth: string) {
  let value: string | null = null;
  if (typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) value = month;
  else if (typeof month === "string" && /^(0?[1-9]|1[0-2])$/.test(month) && typeof year === "string" && /^\d{4}$/.test(year)) {
    value = `${year}-${month.padStart(2, "0")}`;
  }
  if (!value || value < "2000-01") return currentMonth;
  const [y, m] = currentMonth.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return value > next ? currentMonth : value;
}
