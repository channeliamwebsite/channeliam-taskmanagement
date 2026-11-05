"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import type { EmployeePerformance } from "@/lib/super-admin-overview";

type SortKey = "name" | "department" | "total" | "completed" | "inProgress" | "pending" | "overdue" | "completionPercent";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Employee" },
  { key: "department", label: "Department" },
  { key: "total", label: "Total", numeric: true },
  { key: "completed", label: "Completed", numeric: true },
  { key: "inProgress", label: "In progress", numeric: true },
  { key: "pending", label: "Pending", numeric: true },
  { key: "overdue", label: "Overdue", numeric: true },
  { key: "completionPercent", label: "Completion", numeric: true },
];

/**
 * Super admin: per-employee task figures with sorting, and employee and
 * department filters. The date range is a server filter (URL ?from=&to=).
 */
export function EmployeePerformanceTable({ rows, from, to, today }: { rows: EmployeePerformance[]; from: string; to: string; today: string }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "overdue", desc: true });
  const [employee, setEmployee] = useState("");
  const [department, setDepartment] = useState("");
  const departments = useMemo(() => [...new Set(rows.map((r) => r.department ?? ""))].sort(), [rows]);

  const visible = useMemo(() => {
    const list = rows.filter(
      (r) => (!employee || r.userId === employee) && (!department || (department === "__none__" ? !r.department : r.department === department)),
    );
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = a[sort.key] ?? "";
      const y = b[sort.key] ?? "";
      const primary = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return primary * dir || a.name.localeCompare(b.name);
    });
  }, [rows, employee, department, sort]);

  const toggle = (key: SortKey, numeric?: boolean) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: Boolean(numeric) }));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <NativeSelect aria-label="Filter by employee" value={employee} onChange={(e) => setEmployee(e.target.value)} className="sm:w-48">
          <option value="">All employees</option>
          {[...rows].sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
            <option key={r.userId} value={r.userId}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by department" value={department} onChange={(e) => setDepartment(e.target.value)} className="sm:w-44">
          <option value="">All departments</option>
          {departments.map((d) =>
            d ? (
              <option key={d} value={d}>
                {d}
              </option>
            ) : (
              <option key="__none__" value="__none__">
                No department
              </option>
            ),
          )}
        </NativeSelect>
        {/* Date range: a plain GET form, so the server recomputes the figures. */}
        <form className="flex flex-wrap items-center gap-2 text-sm" action="/dashboard">
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">From</span>
            <input type="date" name="from" defaultValue={from} max={today} className="h-9 rounded-lg border bg-background px-2" />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">To</span>
            <input type="date" name="to" defaultValue={to} className="h-9 rounded-lg border bg-background px-2" />
          </label>
          <button type="submit" className="h-9 rounded-lg border px-3 hover:bg-muted">
            Apply
          </button>
          {from || to ? (
            <Link href="/dashboard" className="text-xs text-muted-foreground hover:underline">
              All dates
            </Link>
          ) : null}
        </form>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={`px-2 py-2 font-medium ${c.numeric ? "text-right" : ""}`}>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggle(c.key, c.numeric)}>
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? <ArrowDown className="size-3" aria-hidden="true" /> : <ArrowUp className="size-3" aria-hidden="true" />) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.userId} className="border-t">
                <td className="px-2 py-2">
                  <Link href={`/tasks?scope=all&assignee=${r.userId}&status=all`} className="hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-2 py-2 text-muted-foreground">{r.department ?? "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.total}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.completed}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.inProgress}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.pending}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${r.overdue ? "font-medium text-red-600" : ""}`}>{r.overdue}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.completionPercent}%</td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-2 py-4 text-center text-muted-foreground">
                  No employees match the filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Pending = to do; blocked tasks count in the total only. A task shared by two people counts for both.
        {from || to ? " Date range: tasks due, scheduled or completed in the range." : " All current tasks."}
      </p>
    </div>
  );
}
