import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function load(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("high-frequency Soccer queue drain is schedule/manual only", async () => {
  const yml = await load(".github/workflows/soccer-pitchapi-queue-drain.yml");
  assert.match(yml, /cron:\s*"\*\/5 \* \* \* \*"/);
  assert.match(yml, /workflow_dispatch:/);
  assert.doesNotMatch(yml, /workflow_run:/);
  assert.match(yml, /group:\s*soccer-pitchapi-queue-drain/);
  assert.match(yml, /max-parallel:\s*6/);
});

test("NHL wager evidence is schedule/manual only", async () => {
  const yml = await load(".github/workflows/nhl-wager-evidence.yml");
  assert.match(yml, /cron:\s*"17 \* \* \* \*"/);
  assert.match(yml, /workflow_dispatch:/);
  assert.doesNotMatch(yml, /workflow_run:/);
  assert.match(yml, /group:\s*nhl-wager-evidence/);
});
