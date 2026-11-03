import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { meetingTime, meetingsOnDays, type MeetingSlot } from "./meetings.ts";

const m = (id: string, o: Partial<MeetingSlot> = {}): MeetingSlot => ({
  id,
  title: id,
  url: `https://meet.example.com/${id}`,
  isActive: true,
  meetingDate: null,
  startsAt: null,
  endsAt: null,
  ...o,
});

describe("meetingTime", () => {
  it("formats start and end times", () => {
    assert.equal(meetingTime("15:00:00", "15:30:00"), "15:00–15:30");
    assert.equal(meetingTime("09:30", null), "09:30");
    assert.equal(meetingTime(null, "10:00"), null);
  });
});

describe("meetingsOnDays (calendar)", () => {
  const week = ["2026-11-02", "2026-11-03", "2026-11-04"];

  it("puts a one-off meeting on its date only, and nowhere outside the range", () => {
    const out = meetingsOnDays([m("review", { meetingDate: "2026-11-03", startsAt: "15:00", endsAt: "15:30" }), m("later", { meetingDate: "2026-12-01" })], week);
    assert.deepEqual(out, [{ id: "review", title: "review", url: "https://meet.example.com/review", date: "2026-11-03", time: "15:00–15:30" }]);
  });

  it("repeats a daily meeting on every visible day", () => {
    const out = meetingsOnDays([m("standup", { startsAt: "09:30:00" })], week);
    assert.deepEqual(out.map((o) => `${o.date} ${o.time}`), ["2026-11-02 09:30", "2026-11-03 09:30", "2026-11-04 09:30"]);
  });

  it("leaves out inactive (cancelled) meetings", () => {
    assert.deepEqual(meetingsOnDays([m("gone", { isActive: false, meetingDate: "2026-11-03" })], week), []);
  });

  it("orders each day by start time, untimed meetings last", () => {
    const out = meetingsOnDays(
      [m("untimed", { meetingDate: "2026-11-03" }), m("late", { meetingDate: "2026-11-03", startsAt: "18:00" }), m("early", { meetingDate: "2026-11-03", startsAt: "09:00" })],
      week,
    );
    assert.deepEqual(out.map((o) => o.id), ["early", "late", "untimed"]);
  });
});
