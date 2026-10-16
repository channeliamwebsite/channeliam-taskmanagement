import { ExternalLink, Video } from "lucide-react";
import Link from "next/link";

import type { MeetingLink } from "@/lib/data/meetings";

/** "09:30:00" → "9:30 AM". */
function formatMeetingTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Today's meetings for the viewer (organisation-wide + their team). */
export function MeetingLinksCard({ links, canManage }: { links: MeetingLink[]; canManage: boolean }) {
  if (links.length === 0 && !canManage) return null;
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Video className="size-4 text-muted-foreground" aria-hidden="true" /> Meetings
        </h2>
        {canManage ? (
          <Link href="/settings#meetings" className="text-xs text-muted-foreground hover:underline">
            Manage
          </Link>
        ) : null}
      </div>
      <div className="p-4">
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meeting links yet. Add them in Settings.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {l.kind === "MORNING" ? "Morning meeting" : l.kind === "EVENING" ? "Evening meeting" : "Meeting"}
                    {l.startsAt ? ` · ${formatMeetingTime(l.startsAt)} IST` : ""}
                    {` · ${l.team ? `${l.team} team` : "Everyone"}`}
                    {l.schedule ? ` · ${l.schedule}` : ""}
                  </p>
                </div>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  aria-label={`Join ${l.title}`}
                >
                  Join meeting <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
