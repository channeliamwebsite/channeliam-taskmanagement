import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { notificationHref } from "./notification-links.ts";

describe("notificationHref", () => {
  it("opens the task when there is one", () => {
    assert.equal(notificationHref({ type: "TASK_ASSIGNED", taskId: "t1" }), "/tasks/t1");
  });
  it("sends leave and report notifications to their pages", () => {
    assert.equal(notificationHref({ type: "LEAVE_SUBMITTED", taskId: null }), "/hr/leave");
    assert.equal(notificationHref({ type: "LEAVE_DECIDED", taskId: null }), "/attendance/leave");
    assert.equal(notificationHref({ type: "REPORT_REMINDER", taskId: null }), "/reports");
    assert.equal(notificationHref({ type: "MEETING_SCHEDULED", taskId: null }), "/calendar");
  });
  it("keeps the old default for everything else", () => {
    assert.equal(notificationHref({ type: "SYSTEM", taskId: null }), "/my-day");
    assert.equal(notificationHref({ taskId: null }), "/my-day");
  });
});
