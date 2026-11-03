import "server-only";

import type { AttendanceBreak, AttendanceSession, WorkPolicy } from "@/lib/attendance";
import { approvedLeaveByDate, holidaysByDate, type LeaveApplication, type LeaveType } from "@/lib/hr/leave";
import { createClient } from "@/lib/supabase/server";

import { getWorkPolicy } from "./attendance";
import { loadError } from "./errors";
import { listHolidays } from "./hr";

// Employees with their HR details, and attendance/leave for a date range.
// Always the signed-in user's own client: RLS returns every employee to a
// super admin and only the caller's own rows to anyone else, so passing
// another employee's id can never widen access.

export type Employee = {
  userId: string;
  employeeCode: string | null;
  name: string;
  email: string | null;
  department: string | null;
  designation: string | null;
  managerId: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "INDIVIDUAL";
  isActive: boolean;
  joiningDate: string | null;
  createdAt: string;
  employmentStatus: string | null;
  employmentType: string | null;
};

const PROFILE_COLUMNS = "id, full_name, email, team, job_title, manager_id, role, is_active, created_at";

export async function listEmployees(opts: { userIds?: string[]; includeInactive?: boolean } = {}): Promise<Employee[]> {
  const supabase = await createClient();
  let query = supabase.from("profiles").select(PROFILE_COLUMNS).order("full_name");
  if (!opts.includeInactive) query = query.eq("is_active", true);
  if (opts.userIds) query = query.in("id", opts.userIds.length ? opts.userIds : ["00000000-0000-0000-0000-000000000000"]);
  const [{ data: people, error }, { data: hr, error: hrError }] = await Promise.all([
    query,
    supabase.from("hr_employee_profiles").select("user_id, employee_code, joining_date, employment_status, employment_type"),
  ]);
  if (error) throw loadError("employees", error);
  if (hrError) throw loadError("HR profiles", hrError);
  const byId = new Map((hr ?? []).map((h) => [h.user_id, h]));
  // Only employees whose HR profile the caller can read (own, or all for a super admin).
  return (people ?? [])
    .filter((p) => byId.has(p.id))
    .map((p) => {
      const h = byId.get(p.id)!;
      return {
        userId: p.id,
        employeeCode: h.employee_code,
        name: p.full_name || p.email || "Unknown",
        email: p.email,
        department: p.team,
        designation: p.job_title,
        managerId: p.manager_id,
        role: p.role,
        isActive: p.is_active,
        joiningDate: h.joining_date,
        createdAt: p.created_at,
        employmentStatus: h.employment_status,
        employmentType: h.employment_type,
      };
    });
}

export type AttendanceData = {
  policy: WorkPolicy & { weeklyOffDays: number[] };
  holidays: Map<string, string>;
  sessionsByUser: Map<string, AttendanceSession[]>;
  leaveByUser: Map<string, Map<string, LeaveType>>;
  applicationsByUser: Map<string, LeaveApplication[]>;
};

/** Sessions (with breaks), approved and other leave, holidays and policy for [from, to]. */
export async function loadAttendance(userIds: string[], from: string, to: string): Promise<AttendanceData> {
  const supabase = await createClient();
  const ids = userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"];
  const [policy, holidayList, sessionsRes, appsRes] = await Promise.all([
    getWorkPolicy(),
    listHolidays(from, to),
    supabase
      .from("attendance_sessions")
      .select("id, user_id, workspace_id, work_date, check_in_at, check_out_at")
      .in("user_id", ids)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("check_in_at"),
    supabase
      .from("hr_leave_applications")
      .select("id, user_id, leave_type, start_date, end_date, working_days, reason, status, decided_by, decided_at, rejection_reason, created_at")
      .in("user_id", ids)
      .lte("start_date", to)
      .gte("end_date", from)
      .order("start_date"),
  ]);
  if (sessionsRes.error) throw loadError("attendance", sessionsRes.error);
  if (appsRes.error) throw loadError("leave", appsRes.error);

  const sessionIds = (sessionsRes.data ?? []).map((s) => s.id);
  const breaksBySession = new Map<string, AttendanceBreak[]>();
  for (let i = 0; i < sessionIds.length; i += 200) {
    const { data, error } = await supabase
      .from("attendance_breaks")
      .select("id, session_id, started_at, ended_at")
      .in("session_id", sessionIds.slice(i, i + 200))
      .order("started_at");
    if (error) throw loadError("attendance breaks", error);
    for (const b of data ?? []) {
      const list = breaksBySession.get(b.session_id) ?? [];
      list.push({ id: b.id, sessionId: b.session_id, startedAt: b.started_at, endedAt: b.ended_at });
      breaksBySession.set(b.session_id, list);
    }
  }

  const sessionsByUser = new Map<string, AttendanceSession[]>();
  for (const s of sessionsRes.data ?? []) {
    const list = sessionsByUser.get(s.user_id) ?? [];
    list.push({ id: s.id, workspaceId: s.workspace_id, workDate: s.work_date, checkInAt: s.check_in_at, checkOutAt: s.check_out_at, breaks: breaksBySession.get(s.id) ?? [] });
    sessionsByUser.set(s.user_id, list);
  }
  const applicationsByUser = new Map<string, LeaveApplication[]>();
  for (const a of appsRes.data ?? []) {
    const list = applicationsByUser.get(a.user_id) ?? [];
    list.push({
      id: a.id, userId: a.user_id, type: a.leave_type, start: a.start_date, end: a.end_date, workingDays: a.working_days, reason: a.reason,
      status: a.status, decidedBy: a.decided_by, decidedAt: a.decided_at, rejectionReason: a.rejection_reason, createdAt: a.created_at,
    });
    applicationsByUser.set(a.user_id, list);
  }
  const leaveByUser = new Map([...applicationsByUser].map(([u, apps]) => [u, approvedLeaveByDate(apps)]));
  return { policy, holidays: holidaysByDate(holidayList), sessionsByUser, leaveByUser, applicationsByUser };
}

export type HrProfileDetail = {
  employee: Employee;
  gender: string | null;
  dateOfBirth: string | null;
  personalEmail: string | null;
  phone: string | null;
  address: string | null;
  photoUrl: string | null;
  panLast4: string | null;
  aadhaarLast4: string | null;
  managerName: string | null;
};

/** One HR profile (own, or anyone's for a super admin); null if not visible. Never includes the PAN ciphertext. */
export async function getHrProfile(userId: string): Promise<HrProfileDetail | null> {
  const supabase = await createClient();
  const [employees, hrRes, idRes] = await Promise.all([
    listEmployees({ userIds: [userId], includeInactive: true }),
    supabase.from("hr_employee_profiles").select("gender, date_of_birth, personal_email, phone, address, photo_path").eq("user_id", userId).maybeSingle(),
    supabase.from("hr_employee_identity").select("pan_last4, aadhaar_last4").eq("user_id", userId).maybeSingle(),
  ]);
  if (hrRes.error) throw loadError("HR profile", hrRes.error);
  if (idRes.error) throw loadError("identity", idRes.error);
  const employee = employees[0];
  if (!employee || !hrRes.data) return null;
  let photoUrl: string | null = null;
  if (hrRes.data.photo_path) {
    const { data } = await supabase.storage.from("hr-photos").createSignedUrl(hrRes.data.photo_path, 300);
    photoUrl = data?.signedUrl ?? null;
  }
  let managerName: string | null = null;
  if (employee.managerId) {
    const { data } = await supabase.from("profiles").select("full_name, email").eq("id", employee.managerId).maybeSingle();
    managerName = data ? data.full_name || data.email : null;
  }
  return {
    employee,
    gender: hrRes.data.gender,
    dateOfBirth: hrRes.data.date_of_birth,
    personalEmail: hrRes.data.personal_email,
    phone: hrRes.data.phone,
    address: hrRes.data.address,
    photoUrl,
    panLast4: idRes.data?.pan_last4 ?? null,
    aadhaarLast4: idRes.data?.aadhaar_last4 ?? null,
    managerName,
  };
}
