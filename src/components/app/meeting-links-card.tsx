import { ExternalLink, Video } from "lucide-react";
import Link from "next/link";

import type { MeetingLink } from "@/lib/data/meetings";

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
          <ul className="flex flex-wrap gap-2">
            {links.map((l) => (
              <li key={l.id}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{l.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {l.team ? `${l.team} team` : "Everyone"}
                      {l.schedule ? ` · ${l.schedule}` : ""}
                    </span>
                  </span>
                  <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
