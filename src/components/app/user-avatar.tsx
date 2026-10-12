import { initials } from "@/lib/domain";
import { cn } from "@/lib/utils";

const COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
];

function colorFor(seed: string) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function UserAvatar({
  name,
  seed,
  size = "md",
  className,
}: {
  name: string;
  seed?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = { sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-10 text-sm" };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-background",
        sizes[size],
        colorFor(seed ?? name),
        className,
      )}
      title={name}
      aria-label={name}
      role="img"
    >
      {initials(name) || "?"}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 3,
}: {
  people: { id: string; name: string }[];
  max?: number;
}) {
  if (people.length === 0) return <span className="text-xs text-muted-foreground">Unassigned</span>;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="flex -space-x-1.5">
      {shown.map((p) => (
        <UserAvatar key={p.id} name={p.name} seed={p.id} size="sm" />
      ))}
      {extra > 0 ? (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
