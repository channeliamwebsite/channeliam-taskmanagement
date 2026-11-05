import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_SUBTASKS, parseSubtaskTitles } from "./subtask-titles.ts";

describe("parseSubtaskTitles", () => {
  it("keeps typed order, trims and drops empty lines", () => {
    assert.deepEqual(parseSubtaskTitles("  Draft copy \n\nReview   with client\r\nPublish  "), ["Draft copy", "Review with client", "Publish"]);
  });
  it("drops repeats, ignoring case and spacing", () => {
    assert.deepEqual(parseSubtaskTitles("Design\ndesign\n  DESIGN  \nBuild"), ["Design", "Build"]);
  });
  it("caps the count and the title length", () => {
    const many = Array.from({ length: MAX_SUBTASKS + 5 }, (_, i) => `Step ${i}`).join("\n");
    assert.equal(parseSubtaskTitles(many).length, MAX_SUBTASKS);
    assert.equal(parseSubtaskTitles("x".repeat(600))[0].length, 500);
  });
  it("is empty for blank input", () => {
    assert.deepEqual(parseSubtaskTitles(" \n \n"), []);
  });
});
