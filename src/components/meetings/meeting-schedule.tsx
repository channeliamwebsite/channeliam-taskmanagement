import { Video } from "lucide-react";
import Link from "next/link";

import { Section } from "@/components/app/page-header";
import { MeetingRecordButton } from "@/components/meetings/meeting-record-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { MeetingLink } from "@/lib/data/meetings";
import type { listMeetingRecords } from "@/lib/data/meeting-records";
import { formatDate } from "@/lib/domain";
import { formatClock, meetingOccurrences } from "@/lib/super-admin-overview";

const MEETING_STATUS = {
  SCHEDULED: { label: "Scheduled", variant: "info" },
  HELD: { label: "Held", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
  NOT_RECORDED: { label: "Not recorded", variant: "warning" },
} as const;
const MEETING_KIND = { MORNING: "Morning", EVENING: "Evening", OTHER: "Meeting" } as const;

/**
 * Meetings for the given days with Join, status, agenda/decisions and the
 * meeting-notes button (013). Moved from the super admin dashboard to Team
 * Today (2026-11-06); behaviour unchanged.
 */
export function MeetingSchedule({
  title,
  workspaceId,
  meetings,
  meetingRecords,
  days,
  today,
  taskOptions,
  taskTitles,
}: {
  title: string;
  workspaceId: string;
  meetings: MeetingLink[];
  meetingRecords: Awaited<ReturnType<typeof listMeetingRecords>>;
  days: string[];
  today: string;
  taskOptions: { id: string; title: string }[];
  taskTitles: ReadonlyMap<string, string>;
}) {
  const occurrences = meetingOccurrences(meetings, meetingRecords.records, days, today);
  const recordOf = new Map(meetingRecords.records.map((r) => [`${r.meetingLinkId}:${r.meetingDate}`, r]));
  const textLink = "text-xs font-medium text-primary hover:underline";

  return (
    <Section
      title={title}
      action={
        <Link href="/settings#meetings" className={textLink}>
          Schedule or edit meetings
        </Link>
      }
    >
      {!meetingRecords.available ? (
        <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
          Meeting notes need database migration 013 (meeting records). Meetings are listed; notes can be recorded once it is applied.
        </p>
      ) : null}
      {occurrences.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Video className="size-4" aria-hidden="true" /> No meetings scheduled. Add morning and evening meetings in Settings.
        </p>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b text-left text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="py-2 pr-3 pl-4 font-medium sm:pl-0">When</th>
                <th className="px-3 py-2 font-medium">Meeting</th>
                <th className="px-3 py-2 font-medium">Participants</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Follow-up</th>
                <th className="py-2 pr-4 pl-3 text-right font-medium sm:pr-0">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {occurrences.slice(0, 21).map((o) => {
                const record = recordOf.get(`${o.meeting.id}:${o.date}`) ?? null;
                const status = MEETING_STATUS[o.status];
                return (
                  <tr key={`${o.meeting.id}:${o.date}`} className="align-top">
                    <td className="py-2.5 pr-3 pl-4 whitespace-nowrap sm:pl-0">
                      <span className="block font-medium">{o.date === today ? "Today" : formatDate(o.date)}</span>
                      <span className="text-xs text-muted-foreground">
                        {[formatClock(o.meeting.startsAt), o.recurring ? "daily" : "one-off"].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block font-medium">{o.meeting.title}</span>
                      <span className="text-xs text-muted-foreground">{MEETING_KIND[o.meeting.kind]}</span>
                      {record?.agenda ? <p className="line-clamp-2 text-xs text-muted-foreground">Agenda: {record.agenda}</p> : null}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{o.meeting.team ?? "Everyone"}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      {record?.decisions ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">Decisions: {record.decisions}</p> : null}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {record?.followUpTaskIds.length ? (
                        <ul className="grid gap-0.5">
                          {record.followUpTaskIds.map((id) => (
                            <li key={id}>
                              <Link href={`/tasks/${id}`} className="hover:underline">
                                {taskTitles.get(id) ?? "Task"}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 pl-3 sm:pr-0">
                      <span className="flex justify-end gap-1.5">
                        <a href={o.meeting.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                          Join
                        </a>
                        {meetingRecords.available ? (
                          <MeetingRecordButton
                            workspaceId={workspaceId}
                            meetingId={o.meeting.id}
                            title={`${o.meeting.title} · ${MEETING_KIND[o.meeting.kind]}`}
                            date={o.date}
                            record={record}
                            taskOptions={taskOptions}
                          />
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
