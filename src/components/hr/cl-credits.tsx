import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDay, formatMonth } from "@/lib/attendance";
import { CL_CREDIT_LABELS, type ClCredit } from "@/lib/hr/leave";
import { cn } from "@/lib/utils";

const TONES: Record<ClCredit["status"], string> = {
  AVAILABLE: "text-emerald-700 dark:text-emerald-300",
  USED: "text-muted-foreground",
  EXPIRED: "text-red-700 dark:text-red-300",
  UPCOMING: "text-sky-700 dark:text-sky-300",
};

/** Monthly CL credits: 1 on the 1st of each month, valid for 3 months, used oldest first. */
export function ClCreditsTable({ credits }: { credits: ClCredit[] }) {
  if (!credits.length) return <p className="text-sm text-muted-foreground">No CL credits yet. One is credited on the 1st of every month.</p>;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Credited</TableHead>
            <TableHead>Usable until</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...credits].reverse().map((c) => (
            <TableRow key={c.month}>
              <TableCell className="whitespace-nowrap">{formatMonth(c.month.slice(0, 7))}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDay(c.expiresOn)}</TableCell>
              <TableCell className={cn("whitespace-nowrap font-medium", TONES[c.status])}>{CL_CREDIT_LABELS[c.status]}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">
        1 CL is credited on the 1st of every month and can be used until the end of the third month (January credit: until 31 March). The oldest credit is used first and unused credits expire. Pending applications reserve credits.
      </p>
    </>
  );
}
