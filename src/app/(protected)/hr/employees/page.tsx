import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, Section } from "@/components/app/page-header";
import { STATUS_LABELS, TYPE_LABELS } from "@/components/hr/profile-view";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTE_ROLES } from "@/lib/auth/roles";
import { listEmployees } from "@/lib/data/hr-people";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "Employee profiles" };

export default async function EmployeesPage({ searchParams }: PageProps<"/hr/employees">) {
  await getPageContext(ROUTE_ROLES["/hr"]);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 100) : "";
  const department = typeof sp.department === "string" ? sp.department : "";
  const showInactive = sp.inactive === "1";
  const all = await listEmployees({ includeInactive: true });
  const departments = [...new Set(all.map((e) => e.department).filter(Boolean) as string[])].sort();
  const rows = all.filter(
    (e) =>
      (showInactive || e.isActive) &&
      (!department || e.department === department) &&
      (!q || [e.name, e.email, e.employeeCode, e.designation].some((v) => v?.toLowerCase().includes(q))),
  );

  return (
    <>
      <PageHeader title="Employee profiles" description="HR details for every employee. Identity data is masked." />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Search name, email, ID…" className="h-9 w-full sm:w-64" aria-label="Search employees" />
        <NativeSelect name="department" defaultValue={department} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="inactive" value="1" defaultChecked={showInactive} className="size-4 accent-primary" />
          Include deactivated
        </label>
        <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">Filter</button>
      </form>
      <Section title={`Employees (${rows.length})`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.userId}>
                <TableCell className="font-mono text-xs">{e.employeeCode}</TableCell>
                <TableCell>
                  <Link href={`/hr/employees/${e.userId}`} className="font-medium underline-offset-4 hover:underline">
                    {e.name}
                  </Link>
                  {e.isActive ? null : <span className="ml-2 text-xs text-muted-foreground">Deactivated</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">{e.department ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{e.designation ?? "—"}</TableCell>
                <TableCell>{e.employmentStatus ? STATUS_LABELS[e.employmentStatus] : "—"}</TableCell>
                <TableCell>{e.employmentType ? TYPE_LABELS[e.employmentType] : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </>
  );
}
