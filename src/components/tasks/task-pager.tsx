"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";

/** Previous / next links for the paged task list; keeps the current filters in the URL. */
export function TaskPager({ page, pageCount, total }: { page: number; pageCount: number; total: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (pageCount <= 1) return null;

  const href = (p: number) => {
    const next = new URLSearchParams(params.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  return (
    <nav aria-label="Task pages" className="mt-4 flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">
        Page {page} of {pageCount} · {total} tasks
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ChevronLeft aria-hidden="true" /> Previous
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link href={href(page + 1)} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Next <ChevronRight aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
