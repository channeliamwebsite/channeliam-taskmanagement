// Pure merge rules for the task edit form (no I/O, unit-tested).
//
// The form submits what the user saw when it opened (`base`) and what they
// saved (`submitted`). Only fields the user actually changed are written, so a
// concurrent change to any other field (e.g. a colleague updating the status)
// is never overwritten by stale form values. A field changed both here and by
// someone else, to different values, is a conflict and nothing is saved.

export const EDITABLE_TASK_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "task_type",
  "start_date",
  "scheduled_date",
  "due_date",
  "estimated_hours",
  "parent_task_id",
] as const;

export type EditableTaskField = (typeof EDITABLE_TASK_FIELDS)[number];
export type EditableTaskValues = Record<EditableTaskField, string | number | null>;

export const TASK_FIELD_LABELS: Record<EditableTaskField, string> = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  task_type: "type",
  start_date: "start date",
  scheduled_date: "scheduled date",
  due_date: "due date",
  estimated_hours: "estimated hours",
  parent_task_id: "parent task",
};

/** Numbers are compared by value, so 2 and "2.00" from different sources match. */
function same(a: string | number | null, b: string | number | null) {
  if (a === null || b === null) return a === b;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return a === b;
}

export function planTaskEdit(base: EditableTaskValues, submitted: EditableTaskValues, current: EditableTaskValues) {
  const changes: Partial<EditableTaskValues> = {};
  const conflicts: EditableTaskField[] = [];
  for (const field of EDITABLE_TASK_FIELDS) {
    if (same(submitted[field], base[field])) continue; // untouched in the form: keep whatever is current
    if (!same(current[field], base[field]) && !same(current[field], submitted[field])) {
      conflicts.push(field); // someone else changed it to something different meanwhile
      continue;
    }
    changes[field] = submitted[field];
  }
  return { changes, conflicts };
}
