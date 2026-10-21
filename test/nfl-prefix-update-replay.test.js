import test from "node:test";
import assert from "node:assert/strict";
import { newerPrefixSourceTimestamp } from "../functions/lib/sportWorkingCopy.js";

test("NFL profile replay notices updated data even if both tables have equal counts", () => {
  assert.equal(newerPrefixSourceTimestamp("2026-10-21T10:30:25.297Z", "2026-10-21T01:32:50.576Z"), true);
  assert.equal(newerPrefixSourceTimestamp("2026-10-21T01:32:50.576Z", "2026-10-20T17:58:00.118Z"), true);
});
test("Equal or older source timestamps do not trigger replay", () => {
  assert.equal(newerPrefixSourceTimestamp("2026-10-21T10:30:25Z", "2026-10-21T10:30:25Z"), false);
  assert.equal(newerPrefixSourceTimestamp("2026-10-20T10:30:25Z", "2026-10-21T10:30:25Z"), false);
  assert.equal(newerPrefixSourceTimestamp(null, "2026-10-21T10:30:25Z"), false);
});
test("Missing target timestamp fails towards replay when source has a valid timestamp", () => {
  assert.equal(newerPrefixSourceTimestamp("2026-10-21T10:30:25Z", null), true);
});
