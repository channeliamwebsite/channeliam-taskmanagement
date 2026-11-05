// Subtask titles typed into the new-task dialog (one per line). Pure (unit-tested).

/** Most subtasks created with one task. */
export const MAX_SUBTASKS = 30;

/**
 * Trimmed, non-empty titles in the order typed, without repeats (ignoring case
 * and spacing), at most MAX_SUBTASKS, each cut to the 500-character title limit.
 */
export function parseSubtaskTitles(text: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const title = line.trim().replace(/\s+/g, " ").slice(0, 500);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length === MAX_SUBTASKS) break;
  }
  return titles;
}
