import Image from "next/image";
import type { ReactNode } from "react";

import { BRAND_LOGO_SRC, BRAND_TAGLINE, ORG_NAME, PRODUCT_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** The Channel I'm logo mark. */
export function BrandLogo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <Image
      src={BRAND_LOGO_SRC}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 select-none", className)}
      priority
    />
  );
}

/** Logo + "Channel I'm / Task Management" (+ optional role chip). */
export function BrandLockup({ role, className, large }: { role?: string; className?: string; large?: boolean }) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <BrandLogo size={large ? 48 : 40} />
      <span className="grid min-w-0 gap-0.5 leading-tight">
        <span className={cn("truncate font-semibold tracking-tight text-foreground", large ? "text-xl" : "text-[15px]")}>{ORG_NAME}</span>
        <span className="truncate text-xs text-muted-foreground">{PRODUCT_NAME}</span>
        {role ? (
          <span className="mt-0.5 w-fit rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-soft-foreground">{role}</span>
        ) : null}
      </span>
    </span>
  );
}

/** Small brand card at the foot of the sidebar. */
export function BrandFooterCard() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-gradient-to-br from-brand-soft to-card p-3">
      <BrandLogo size={32} />
      <div className="grid min-w-0 leading-tight">
        <span className="truncate text-sm font-semibold">{ORG_NAME}</span>
        <span className="truncate text-xs text-muted-foreground">{BRAND_TAGLINE}</span>
      </div>
    </div>
  );
}

/** Centered layout for the signed-out pages (sign in, forgot / set password). */
export function AuthShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="relative flex min-h-svh flex-1 items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-brand-soft/80 to-transparent"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandLockup large />
        </div>
        {children}
        {footer ? <div className="mt-6 text-center text-xs text-muted-foreground">{footer}</div> : null}
      </div>
    </main>
  );
}
