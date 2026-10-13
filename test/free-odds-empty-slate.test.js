import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("NHL free-odds collector returns EMPTY_SLATE instead of 503 when no events", async () => {
  const src = await read("functions/api/nhl-free-odds-collect.js");
  assert.match(src, /skipReason:"EMPTY_SLATE"/);
  assert.match(src, /signalClass:"EXPECTED_EMPTY_SLATE"/);
  assert.match(src, /if\(!events\.length\)/);
  assert.match(src, /return json\(\{[\s\S]*skipReason:"EMPTY_SLATE"[\s\S]*\},200\)/);
});

test("MLB free-odds collector returns EMPTY_SLATE for zero CT-date games", async () => {
  const src = await read("functions/api/mlb-free-odds-collect.js");
  assert.match(src, /skipReason:"EMPTY_SLATE"/);
  assert.match(src, /signalClass:"EXPECTED_EMPTY_SLATE"/);
  assert.match(src, /if\(!events\.length\)/);
  // Non-empty slate without quotes must still fail closed.
  assert.match(src, /return json\(payload,pairedMoneylines\?200:503\)/);
});

test("free-odds workflows accept EMPTY_SLATE as green", async () => {
  const nhl = await read(".github/workflows/nhl-free-odds-collect.yml");
  const mlb = await read(".github/workflows/mlb-free-odds-collect.yml");
  for (const yml of [nhl, mlb]) {
    assert.match(yml, /skipReason=="EMPTY_SLATE"/);
    assert.match(yml, /\.skipped==true/);
  }
});

test("PitchAPI drain peeks queue status before spawning workers", async () => {
  const status = await read("functions/api/soccer-pitchapi-queue-status.js");
  const workflow = await read(".github/workflows/soccer-pitchapi-queue-drain.yml");
  assert.match(status, /pendingEligible/);
  assert.match(status, /EXPECTED_EMPTY_QUEUE/);
  // Peek may read LEASED rows for eligibility count but must never mutate/lease.
  assert.doesNotMatch(status, /\bUPDATE\b|\.run\(\)|lease_until=/);
  assert.match(workflow, /soccer-pitchapi-queue-status/);
  assert.match(workflow, /needs:\s*preflight/);
  assert.match(workflow, /has_work == 'true'/);
});
