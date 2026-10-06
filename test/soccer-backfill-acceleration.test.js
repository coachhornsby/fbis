import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("soccer accelerated backfill is six-worker, bounded, and contention-safe", async () => {
  const workflow=await readFile(new URL("../.github/workflows/soccer-pitchapi-queue-drain.yml",import.meta.url),"utf8");
  const discover=await readFile(new URL("../functions/api/soccer-pitchapi-discover.js",import.meta.url),"utf8");
  const claim=await readFile(new URL("../functions/api/soccer-pitchapi-queue-claim.js",import.meta.url),"utf8");
  const complete=await readFile(new URL("../functions/api/soccer-pitchapi-queue-complete.js",import.meta.url),"utf8");
  assert.match(workflow,/cron:\s*"\*\/5 \* \* \* \*"/);
  assert.match(workflow,/workflow_run:/);
  assert.match(workflow,/workflows:\s*\["CI"\]/);
  assert.match(workflow,/github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow,/github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow,/github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(workflow,/payload="\$\(jq -nc/);
  assert.match(workflow,/-d "\$payload"/);
  assert.doesNotMatch(workflow,/-d "\{"leagueKey"/);
  assert.match(workflow,/max-parallel:\s*6/);
  assert.match(workflow,/worker:\s*\[1, 2, 3, 4, 5, 6\]/);
  assert.match(workflow,/for iteration in 1 2 3; do/);
  assert.match(discover,/0,12,'PENDING'/);
  assert.match(claim,/claimAttempt<=5/);
  assert.match(claim,/pageSize:Math\.max\(12/);
  assert.match(complete,/Math\.max\(12,Number\(row\.page_size\)\|\|12\)/);
});
