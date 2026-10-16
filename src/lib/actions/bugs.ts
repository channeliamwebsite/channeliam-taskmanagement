"use server";

import { refresh } from "next/cache";

import { BUG_STATUSES, type BugStatus } from "@/lib/domain";

import { NOT_PERMITTED, cleanText, dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

export type BugReportInput = {
  title: string;
  description: string;
  page?: string | null;
  steps?: string | null;
};

/** Any workspace member can report a bug; RLS pins reporter = caller and status = OPEN. */
export async function createBugReport(workspaceId: string, input: BugReportInput): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");
  const title = cleanText(input.title, 200);
  if (!title) return fail("Give the bug a short title.");
  const description = cleanText(input.description, 5000);
  if (!description) return fail("Describe what went wrong.");

  const { error } = await actor.supabase.from("bug_reports").insert({
    workspace_id: workspaceId,
    reported_by: actor.userId,
    title,
    description,
    page: cleanText(input.page, 300),
    steps: cleanText(input.steps, 5000),
  });
  if (error) return fail(dbError(error, "Could not submit the bug report."));
  refresh();
  return ok();
}

/** Admins and super admins triage reports (RLS allows only the status column to change). */
export async function updateBugStatus(id: string, status: BugStatus): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role === "INDIVIDUAL") return fail(NOT_PERMITTED);
  if (!isUuid(id)) return fail("Invalid bug report.");
  if (!BUG_STATUSES.includes(status)) return fail("Choose a valid status.");

  const { data, error } = await actor.supabase.from("bug_reports").update({ status }).eq("id", id).select("id");
  if (error) return fail(dbError(error, "Could not update the bug report."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}
