import "server-only";

import type { Holiday, LeaveApplication, LeaveType } from "@/lib/hr/leave";
import { createClient } from "@/lib/supabase/server";

import { loadError } from "./errors";

const APP_COLUMNS = "id, user_id, leave_type, start_date, end_date, working_days, reason, status, decided_by, decided_at, rejection_reason, created_at";

type AppRow = {
  id: string;
  user_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  working_days: number;
  reason: string;
  status: LeaveApplication["status"];
  decided_by: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  created_at: string;
};

function toApplication(r: AppRow): LeaveApplication {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.leave_type,
    start: r.start_date,
    end: r.end_date,
    workingDays: r.working_days,
    reason: r.reason,
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    rejectionReason: r.rejection_reason,
    createdAt: r.created_at,
  };
}

/** One employee's applications overlapping [from, to] (RLS: own, or any for a super admin). */
export async function listLeaveForUser(userId: string, from: string, to: string): Promise<LeaveApplication[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hr_leave_applications")
    .select(APP_COLUMNS)
    .eq("user_id", userId)
    .lte("start_date", to)
    .gte("end_date", from)
    .order("start_date", { ascending: false });
  if (error) throw loadError("leave applications", error);
  return (data ?? []).map(toApplication);
}

export type ApplicantInfo = { userId: string; name: string; email: string | null; department: string | null; jobTitle: string | null };

/** Applications for the super admin's review, with applicant details. RLS returns nothing to others. */
export async function listLeaveForReview(status: LeaveApplication["status"] | "ALL", year: number): Promise<(LeaveApplication & { applicant: ApplicantInfo })[]> {
  const supabase = await createClient();
  let query = supabase
    .from("hr_leave_applications")
    .select(`${APP_COLUMNS}, applicant:profiles!hr_leave_applications_user_id_fkey(id, full_name, email, team, job_title)`)
    .gte("start_date", `${year}-01-01`)
    .lte("start_date", `${year}-12-31`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (status !== "ALL") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw loadError("leave applications for review", error);
  return (data ?? []).map((r) => ({
    ...toApplication(r as AppRow),
    applicant: {
      userId: r.user_id,
      name: r.applicant?.full_name || r.applicant?.email || "Unknown",
      email: r.applicant?.email ?? null,
      department: r.applicant?.team ?? null,
      jobTitle: r.applicant?.job_title ?? null,
    },
  }));
}

export type LeaveBalanceRow = { type: LeaveType; allowance: number | null; approved: number; pending: number; available: number | null };

/** Leave summary for a year (the database refuses someone else's unless the caller is a super admin). */
export async function getLeaveBalance(userId: string | null, year: number): Promise<LeaveBalanceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hr_leave_balance", { p_user_id: userId ?? undefined, p_year: year });
  if (error) throw loadError("leave balance", error);
  return (data ?? []).map((r) => ({
    type: r.leave_type,
    allowance: r.allowance === null ? null : Number(r.allowance),
    approved: r.approved,
    pending: r.pending,
    available: r.available === null ? null : Number(r.available),
  }));
}

/** Holidays in [from, to]; cancelled ones only when asked. */
export async function listHolidays(from: string, to: string, includeCancelled = false): Promise<Holiday[]> {
  const supabase = await createClient();
  let query = supabase.from("hr_public_holidays").select("id, name, holiday_date, description, is_active").gte("holiday_date", from).lte("holiday_date", to).order("holiday_date");
  if (!includeCancelled) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw loadError("public holidays", error);
  return (data ?? []).map((h) => ({ id: h.id, name: h.name, date: h.holiday_date, description: h.description, isActive: h.is_active }));
}

/** Annual CL allowance from the policy. */
export async function getClAllowance(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("hr_leave_policies").select("annual_allowance").eq("leave_type", "CL").maybeSingle();
  if (error) throw loadError("leave policy", error);
  return Number(data?.annual_allowance ?? 12);
}
