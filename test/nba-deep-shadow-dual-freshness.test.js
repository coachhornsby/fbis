import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newerPrefixSourceTimestamp } from "../functions/lib/sportWorkingCopy.js";

const source = readFileSync(new URL("../functions/lib/sportWorkingCopy.js", import.meta.url), "utf8");

test("NBA deep-game rows replay when in-place feature refresh changes created_at without grading", () => {
  assert.match(source, /nba_deep_game_shadow:\s*\["created_at", "graded_at"\]/);
  assert.match(source, /for \(const field of \[freshnessColumns\]\.flat\(\)\)/);
  assert.match(source, /newerPrefixSourceTimestamp\(sourceStamp\?\.latest, targetStamp\?\.latest\)/);
  assert.equal(newerPrefixSourceTimestamp("2026-10-23T00:44:25.697Z", "2026-10-22T20:13:08.895Z"), true);
  assert.equal(newerPrefixSourceTimestamp(null, null), false);
});

test("NBA graded deep-game rows still replay without created_at change", () => {
  assert.equal(newerPrefixSourceTimestamp("2026-10-23T04:00:00Z", "2026-10-23T03:00:00Z"), true);
  assert.equal(newerPrefixSourceTimestamp("2026-10-23T04:00:00Z", "2026-10-23T04:00:00Z"), false);
});
