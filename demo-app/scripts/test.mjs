import test from "node:test";
import assert from "node:assert/strict";
import { APP_VERSION, formatBanner, computeChecksum } from "../src/app.mjs";

test("formatBanner includes version and commit", () => {
  const out = formatBanner(APP_VERSION, "abc1234");
  assert.ok(out.includes(`v${APP_VERSION}`), "banner must include version");
  assert.ok(out.includes("abc1234"), "banner must include commit");
});

test("computeChecksum is deterministic", () => {
  assert.equal(computeChecksum("rail"), computeChecksum("rail"));
  assert.equal(computeChecksum("rail").length, 8);
});
