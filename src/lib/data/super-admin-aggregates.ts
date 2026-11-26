import "server-only";

import type { DateRange } from "@/lib/super-admin-overview";
import type { DepartmentCountsRow, EmployeeCountsRow, ProjectCountsRow, StatusCounts } from "@/lib/super-admin-overview";
import { createClient } from "@/lib/supabase/server";
import { loadError } from "./errors";

/**
 * Company-wide task aggregates for the Super Admin dashboard, computed in
 * the database (migration 053's company_*_task_counts) instead of fetching
 * every task into the app. Each loader's row shape mirrors the matching pure
 * function in super-admin-overview.ts exactly; the *FromCounts functions
 * there merge these (sparse) rows with the app's own members/projects list.
 */

/** Always all-time (mirrors statusCounts); exactly one row. */
export async function loadCompanyTaskStatusCounts(workspaceIds: string[], today: string): Promise<StatusCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("company_task_status_counts", { p_workspace_ids: workspaceIds, p_today: today })
    .single();
  if (error) throw loadError("Failed to load company task counts", error);
  return {
    total: data.total,
    completed: data.completed,
    inProgress: data.in_progress,
    pending: data.pending,
    blocked: data.blocked,
    overdue: data.overdue,
  };
}

/** Sparse: a row only for an employee with >=1 matching task (mirrors employeePerformance's source data). */
export async function loadCompanyEmployeeTaskCounts(
  workspaceIds: string[],
  today: string,
  timeZone: string,
  range: DateRange | null,
): Promise<EmployeeCountsRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_employee_task_counts", {
    p_workspace_ids: workspaceIds,
    p_today: today,
    p_timezone: timeZone,
    p_range_from: range?.from,
    p_range_to: range?.to,
  });
  if (error) throw loadError("Failed to load company employee task counts", error);
  return data.map((r) => ({
    userId: r.user_id,
    total: r.total,
    completed: r.completed,
    inProgress: r.in_progress,
    pending: r.pending,
    blocked: r.blocked,
    overdue: r.overdue,
  }));
}

/** Sparse: a row only for a department with >=1 matching task (mirrors departmentProgress's source data). */
export async function loadCompanyDepartmentTaskCounts(
  workspaceIds: string[],
  timeZone: string,
  range: DateRange | null,
): Promise<DepartmentCountsRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_department_task_counts", {
    p_workspace_ids: workspaceIds,
    p_timezone: timeZone,
    p_range_from: range?.from,
    p_range_to: range?.to,
  });
  if (error) throw loadError("Failed to load company department task counts", error);
  return data.map((r) => ({ department: r.department, total: r.total, completed: r.completed }));
}

/**
 * Sparse: a row only for a project with >=1 in-range task of any kind (so
 * last_update can be real even when total is 0 -- see the RPC's own
 * comment). Mirrors projectProgress's source data.
 */
export async function loadCompanyProjectTaskCounts(
  workspaceIds: string[],
  today: string,
  timeZone: string,
  range: DateRange | null,
): Promise<ProjectCountsRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_project_task_counts", {
    p_workspace_ids: workspaceIds,
    p_today: today,
    p_timezone: timeZone,
    p_range_from: range?.from,
    p_range_to: range?.to,
  });
  if (error) throw loadError("Failed to load company project task counts", error);
  return data.map((r) => ({
    projectId: r.project_id,
    total: r.total,
    completed: r.completed,
    inProgress: r.in_progress,
    pending: r.pending,
    blocked: r.blocked,
    overdue: r.overdue,
    nextDue: r.next_due,
    lastUpdate: r.last_update,
    assignees: r.assignees ?? [],
  }));
}
