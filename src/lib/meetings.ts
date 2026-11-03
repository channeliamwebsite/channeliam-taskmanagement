// Pure calendar rules for meetings (no I/O, unit-tested).

export type MeetingSlot = {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
  /** One-off date, or null for a meeting held every day. */
  meetingDate: string | null;
  /** HH:MM or HH:MM:SS in the workspace's time, or null. */
  startsAt: string | null;
  endsAt: string | null;
};

export type MeetingOnDay = { id: string; title: string; url: string; date: string; time: string | null };

/** "15:00–15:30", "15:00" or null. */
export function meetingTime(startsAt: string | null, endsAt: string | null): string | null {
  if (!startsAt) return null;
  return endsAt ? `${startsAt.slice(0, 5)}–${endsAt.slice(0, 5)}` : startsAt.slice(0, 5);
}

/**
 * Active meetings on each of the given days: one-off meetings on their date,
 * daily meetings on every day. Sorted by day, then start time (untimed last).
 */
export function meetingsOnDays(meetings: readonly MeetingSlot[], days: readonly string[]): MeetingOnDay[] {
  const wanted = new Set(days);
  const out: { meeting: MeetingOnDay; sort: string }[] = [];
  for (const m of meetings) {
    if (!m.isActive) continue;
    const dates = m.meetingDate === null ? days : wanted.has(m.meetingDate) ? [m.meetingDate] : [];
    for (const date of dates) {
      out.push({ meeting: { id: m.id, title: m.title, url: m.url, date, time: meetingTime(m.startsAt, m.endsAt) }, sort: m.startsAt ?? "99" });
    }
  }
  return out
    .sort((a, b) => a.meeting.date.localeCompare(b.meeting.date) || a.sort.localeCompare(b.sort) || a.meeting.title.localeCompare(b.meeting.title))
    .map((o) => o.meeting);
}
