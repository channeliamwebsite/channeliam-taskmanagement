"use server";

import { refresh } from "next/cache";

import { isIsoDate } from "@/lib/hr/leave";
import { decryptPan, encryptPan, normalizeAadhaarLast4, normalizePan, panLast4 } from "@/lib/hr/pan";
import { allPanKeys, currentPanKey, isPanKeyConfigured } from "@/lib/hr/pan-key";
import { createAdminClient } from "@/lib/supabase/admin";

import { NOT_PERMITTED, dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

// HR profiles (035), super admins only. Ordinary fields are written with the
// super admin's own client (RLS + column grants + audit trigger). Identity
// data goes through hr_set_identity; a PAN reveal is audited by
// hr_log_pan_reveal before the ciphertext is read (service role) and
// decrypted here. Plaintext PANs are never logged, stored or put in a URL.

async function superAdmin() {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can manage HR profiles.");
  return actor;
}

const GENDERS = ["FEMALE", "MALE", "OTHER", "UNDISCLOSED"] as const;
const STATUSES = ["ACTIVE", "PROBATION", "NOTICE_PERIOD", "RESIGNED", "TERMINATED"] as const;
const TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"] as const;

export type HrProfileInput = {
  gender: string | null;
  dateOfBirth: string | null;
  personalEmail: string | null;
  phone: string | null;
  address: string | null;
  joiningDate: string | null;
  employmentStatus: string;
  employmentType: string;
};

function text(value: unknown, max: number) {
  const v = typeof value === "string" ? value.trim() : "";
  return v ? v.slice(0, max) : null;
}

export async function updateHrProfile(userId: string, input: Partial<HrProfileInput>): Promise<ActionResult> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  if (!isUuid(userId)) return fail("Invalid employee.");
  const gender = text(input.gender, 20);
  if (gender && !GENDERS.includes(gender as (typeof GENDERS)[number])) return fail("Choose a valid gender.");
  const dob = text(input.dateOfBirth, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (dob && (!isIsoDate(dob) || dob > today || dob < "1900-01-01")) return fail("Enter a valid date of birth (not in the future).");
  const joining = text(input.joiningDate, 10);
  if (joining && (!isIsoDate(joining) || joining < "1990-01-01")) return fail("Enter a valid joining date.");
  const personalEmail = text(input.personalEmail, 254)?.toLowerCase() ?? null;
  if (personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalEmail)) return fail("Enter a valid personal email.");
  const phone = text(input.phone, 20);
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) return fail("Enter a valid phone number.");
  const status = text(input.employmentStatus, 20) ?? "ACTIVE";
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return fail("Choose a valid employment status.");
  const type = text(input.employmentType, 20) ?? "FULL_TIME";
  if (!TYPES.includes(type as (typeof TYPES)[number])) return fail("Choose a valid employment type.");

  const { data, error } = await actor.supabase
    .from("hr_employee_profiles")
    .update({
      gender,
      date_of_birth: dob,
      personal_email: personalEmail,
      phone,
      address: text(input.address, 500),
      joining_date: joining,
      employment_status: status,
      employment_type: type,
    })
    .eq("user_id", userId)
    .select("user_id");
  if (error) return fail(dbError(error, "Could not save the HR profile."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}

/**
 * Sets or clears the PAN and/or Aadhaar last four. Pass undefined to leave a
 * value unchanged, "" to clear it. The PAN is encrypted here before it leaves
 * the server process.
 */
export async function setIdentity(userId: string, input: { pan?: string; aadhaarLast4?: string }): Promise<ActionResult> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  if (!isUuid(userId)) return fail("Invalid employee.");
  const updatePan = input.pan !== undefined;
  const updateAadhaar = input.aadhaarLast4 !== undefined;
  if (!updatePan && !updateAadhaar) return fail("Nothing to save.");

  let ciphertext: string | null = null;
  let version: number | null = null;
  let last4: string | null = null;
  if (updatePan && input.pan!.trim() !== "") {
    const pan = normalizePan(input.pan);
    if (!pan) return fail("Enter a valid PAN (5 letters, 4 digits, 1 letter).");
    if (!isPanKeyConfigured()) return fail("PAN storage is not configured on this server (HR_ENCRYPTION_KEY).");
    const key = currentPanKey();
    ciphertext = encryptPan(pan, userId, key);
    version = key.version;
    last4 = panLast4(pan);
  }
  let aadhaar: string | null = null;
  if (updateAadhaar && input.aadhaarLast4!.trim() !== "") {
    aadhaar = normalizeAadhaarLast4(input.aadhaarLast4);
    if (!aadhaar) return fail("Enter only the last 4 digits of the Aadhaar number.");
  }

  // Generated types mark these arguments non-null; the function accepts null to clear a value.
  const { error } = await actor.supabase.rpc("hr_set_identity", {
    p_user_id: userId,
    p_pan_ciphertext: ciphertext as string,
    p_pan_key_version: version as number,
    p_pan_last4: last4 as string,
    p_aadhaar_last4: aadhaar as string,
    p_update_pan: updatePan,
    p_update_aadhaar: updateAadhaar,
  });
  if (error) return fail(dbError(error, "Could not save the identity details."));
  refresh();
  return ok();
}

/** Audited, super-admin-only reveal of one employee's full PAN. */
export async function revealPan(userId: string, reason: string): Promise<ActionResult<{ pan: string }>> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  if (!isUuid(userId)) return fail("Invalid employee.");
  const why = (reason ?? "").trim();
  if (why.length < 3 || why.length > 200) return fail("Give a reason for viewing the full PAN (3 to 200 characters).");
  if (!isPanKeyConfigured()) return fail("PAN storage is not configured on this server (HR_ENCRYPTION_KEY).");

  // 1. Audit first, as the super admin (the database re-checks the role).
  const { error: auditError } = await actor.supabase.rpc("hr_log_pan_reveal", { p_user_id: userId, p_reason: why });
  if (auditError) return fail(dbError(auditError, "Could not record the request, so the PAN was not shown."));

  // 2. Only then read the ciphertext (not readable by any signed-in role) and decrypt it.
  const { data, error } = await createAdminClient().from("hr_employee_identity").select("pan_ciphertext").eq("user_id", userId).maybeSingle();
  if (error || !data?.pan_ciphertext) return fail("No PAN is recorded for this employee.");
  try {
    return ok({ pan: decryptPan(data.pan_ciphertext, userId, allPanKeys()) });
  } catch {
    console.error("[hr] PAN could not be decrypted", JSON.stringify({ targetId: userId }));
    return fail("The PAN could not be decrypted with the configured keys.");
  }
}
