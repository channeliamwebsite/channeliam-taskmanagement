import { UserAvatar } from "@/components/app/user-avatar";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { HrProfileDetail } from "@/lib/data/hr-people";
import { maskAadhaar, maskPan } from "@/lib/hr/pan";

export const GENDER_LABELS: Record<string, string> = { FEMALE: "Female", MALE: "Male", OTHER: "Other", UNDISCLOSED: "Prefer not to say" };
export const STATUS_LABELS: Record<string, string> = { ACTIVE: "Active", PROBATION: "Probation", NOTICE_PERIOD: "Notice period", RESIGNED: "Resigned", TERMINATED: "Terminated" };
export const TYPE_LABELS: Record<string, string> = { FULL_TIME: "Full-time", PART_TIME: "Part-time", CONTRACT: "Contract", INTERN: "Intern" };

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium" title={value ?? undefined}>
        {value || "—"}
      </dd>
    </div>
  );
}

/** Read-only HR profile. Identity values are always masked here. */
export function ProfileView({ profile }: { profile: HrProfileDetail }) {
  const e = profile.employee;
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-4">
        {profile.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
          <img src={profile.photoUrl} alt="" className="size-16 rounded-full object-cover" />
        ) : (
          <UserAvatar name={e.name} seed={e.userId} size="lg" />
        )}
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{e.name}</p>
          <p className="text-sm text-muted-foreground">
            {e.employeeCode ?? "—"} · {ROLE_LABELS[e.role]}
            {e.isActive ? "" : " · Deactivated"}
          </p>
        </div>
      </div>
      <section aria-labelledby="hr-personal">
        <h3 id="hr-personal" className="mb-2 text-sm font-semibold">Personal</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Gender" value={profile.gender ? GENDER_LABELS[profile.gender] : null} />
          <Field label="Date of birth" value={profile.dateOfBirth} />
          <Field label="Personal email" value={profile.personalEmail} />
          <Field label="Phone" value={profile.phone} />
          <div className="col-span-2">
            <Field label="Address" value={profile.address} />
          </div>
        </dl>
      </section>
      <section aria-labelledby="hr-official">
        <h3 id="hr-official" className="mb-2 text-sm font-semibold">Official</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Employee ID" value={e.employeeCode} />
          <Field label="Official email" value={e.email} />
          <Field label="Department" value={e.department} />
          <Field label="Designation" value={e.designation} />
          <Field label="Reporting manager" value={profile.managerName} />
          <Field label="Joining date" value={e.joiningDate} />
          <Field label="Employment status" value={e.employmentStatus ? STATUS_LABELS[e.employmentStatus] : null} />
          <Field label="Employment type" value={e.employmentType ? TYPE_LABELS[e.employmentType] : null} />
        </dl>
      </section>
      <section aria-labelledby="hr-identity">
        <h3 id="hr-identity" className="mb-2 text-sm font-semibold">Identity</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="PAN" value={maskPan(profile.panLast4)} />
          <Field label="Aadhaar (last 4 digits only)" value={maskAadhaar(profile.aadhaarLast4)} />
        </dl>
      </section>
    </div>
  );
}
