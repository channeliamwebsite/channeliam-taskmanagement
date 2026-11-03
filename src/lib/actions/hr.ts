"use server";

import { refresh } from "next/cache";

import { isIsoDate, validateLeaveInput, type LeaveInput } from "@/lib/hr/leave";

import { NOT_PERMITTED, dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

// Leave and public holidays (034). Every rule is enforced in the database
// (functions, constraints and RLS); super-admin actions are also checked here
// first so others get a plain answer without a database round trip.

async function superAdmin() {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can do that.");
  return actor;
}

/** Working days between two dates (Sundays and public holidays excluded), for the form preview. */
export async function previewWorkingDays(start: string, end: string): Promise<ActionResult<{ days: number }>> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return ok({ days: 0 });
  const { data, error } = await actor.supabase.rpc("hr_working_days", { p_start: start, p_end: end });
  if (error) return fail(dbError(error));
  return ok({ days: data ?? 0 });
}

export async function applyForLeave(input: Partial<Record<keyof LeaveInput, unknown>>): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  const parsed = validateLeaveInput(input);
  if (!parsed.ok) return fail(parsed.error);
  const v = parsed.value;
  // The applicant is always the signed-in user (auth.uid() in the database); no user id is sent.
  const { error } = await actor.supabase.rpc("hr_apply_leave", { p_type: v.type, p_start: v.start, p_end: v.end, p_reason: v.reason });
  if (error) return fail(dbError(error, "Could not submit the application. Please try again."));
  refresh();
  return ok();
}

export async function cancelLeave(id: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(id)) return fail("Invalid application.");
  const { error } = await actor.supabase.rpc("hr_cancel_leave", { p_id: id });
  if (error) return fail(dbError(error, "Could not cancel the application."));
  refresh();
  return ok();
}

export async function decideLeave(id: string, approve: boolean, rejectionReason?: string): Promise<ActionResult> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  if (!isUuid(id)) return fail("Invalid application.");
  if (!approve && (rejectionReason ?? "").trim().length < 3) return fail("Give a reason for the rejection (at least 3 characters).");
  const { error } = await actor.supabase.rpc("hr_decide_leave", {
    p_id: id,
    p_approve: approve,
    p_rejection_reason: approve ? undefined : rejectionReason!.trim().slice(0, 1000),
  });
  if (error) return fail(dbError(error, "Could not record the decision."));
  refresh();
  return ok();
}

export type HolidayInput = { name: string; date: string; description?: string | null };

function validateHoliday(input: Partial<Record<keyof HolidayInput, unknown>>): { ok: true; value: HolidayInput } | { ok: false; error: string } {
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 120) return { ok: false, error: "Holiday name must be 2 to 120 characters." };
  if (!isIsoDate(input.date)) return { ok: false, error: "Choose a valid date." };
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > 500) return { ok: false, error: "Description must be at most 500 characters." };
  return { ok: true, value: { name, date: input.date, description: description || null } };
}

export async function createHoliday(input: Partial<Record<keyof HolidayInput, unknown>>): Promise<ActionResult> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  const parsed = validateHoliday(input);
  if (!parsed.ok) return fail(parsed.error);
  const { error } = await actor.supabase
    .from("hr_public_holidays")
    .insert({ name: parsed.value.name, holiday_date: parsed.value.date, description: parsed.value.description });
  if (error) return fail(error.code === "23505" ? "There is already a holiday on that date." : dbError(error));
  refresh();
  return ok();
}

export async function updateHoliday(id: string, input: Partial<Record<keyof HolidayInput, unknown>>): Promise<ActionResult> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  if (!isUuid(id)) return fail("Invalid holiday.");
  const parsed = validateHoliday(input);
  if (!parsed.ok) return fail(parsed.error);
  const { data, error } = await actor.supabase
    .from("hr_public_holidays")
    .update({ name: parsed.value.name, holiday_date: parsed.value.date, description: parsed.value.description })
    .eq("id", id)
    .eq("is_active", true)
    .select("id");
  if (error) return fail(error.code === "23505" ? "There is already a holiday on that date." : dbError(error));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}

/** Cancels a holiday (kept for history; the date counts as a working day again). */
export async function cancelHoliday(id: string): Promise<ActionResult> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  if (!isUuid(id)) return fail("Invalid holiday.");
  const { data, error } = await actor.supabase.from("hr_public_holidays").update({ is_active: false }).eq("id", id).eq("is_active", true).select("id");
  if (error) return fail(dbError(error));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}

/** Sets the company's annual Casual Leave allowance (employees with an individual override keep theirs). */
export async function setClAllowance(days: number): Promise<ActionResult> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  if (!Number.isFinite(days) || days < 0 || days > 366 || Math.round(days * 2) !== days * 2) return fail("Enter a whole or half number of days between 0 and 366.");
  const { data, error } = await actor.supabase.from("hr_leave_policies").update({ annual_allowance: days }).eq("leave_type", "CL").select("leave_type");
  if (error) return fail(dbError(error));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}
