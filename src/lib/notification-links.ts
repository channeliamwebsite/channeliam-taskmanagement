// Where a notification opens. Pure (unit-tested); used by the inbox and the bell menu.

export function notificationHref(n: { type?: string | null; taskId: string | null }): string {
  if (n.taskId) return `/tasks/${n.taskId}`;
  switch (n.type) {
    case "LEAVE_SUBMITTED":
      return "/hr/leave"; // super admins decide leave there
    case "LEAVE_DECIDED":
      return "/attendance/leave";
    case "REPORT_REMINDER":
      return "/reports";
    case "MEETING_SCHEDULED":
    case "MEETING_UPDATED":
    case "MEETING_CANCELLED":
      return "/calendar";
    default:
      return "/my-day";
  }
}
