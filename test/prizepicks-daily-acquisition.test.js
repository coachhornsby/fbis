import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("PrizePicks workflow has redundant guarded morning schedules and a workflow-file-only recovery trigger",()=>{
  const y=fs.readFileSync(".github/workflows/prizepicks-targeted-props.yml","utf8");
  assert.match(y,/cron: "5,35 13,14,15,16 \* \* \*"/);
  assert.doesNotMatch(y,/timezone:/);
  assert.match(y,/push:\s*\n\s+branches: \[main\]\s*\n\s+paths: \["\.github\/workflows\/prizepicks-targeted-props\.yml"\]/);
  assert.match(y,/Reuse existing daily reservation without a replacement paid call/);
  assert.match(y,/RECOVER_ARTIFACT/);
  assert.match(y,/Reserve today's single paid PrizePicks acquisition/);
  assert.match(y,/Pull full PrizePicks board once/);
  assert.doesNotMatch(y,/playerNames:\$players/);
  assert.doesNotMatch(y,/run-sync-get-dataset-items|listLeagues/);
  assert.match(y,/api\/apify-acquire/);
  assert.match(y,/bounded resumable batches/);
});
test("PrizePicks API enforces durable daily acquisition reservation",()=>{
  const s=fs.readFileSync("functions/api/prizepicks-props.js","utf8");
  assert.match(s,/ALREADY_COLLECTED_TODAY/);
  assert.match(s,/prizepicks_daily_acquisitions/);
  assert.match(s,/ESTIMATED_START/);
  assert.match(s,/stale_past_prizepicks_rows/);
  assert.doesNotMatch(s,/future_or_non_today_prizepicks_rows/);
});
test("legacy paid collector is disabled",()=>{
  const s=fs.readFileSync("functions/api/prizepicks-collect.js","utf8");
  assert.match(s,/LEGACY_PRIZEPICKS_COLLECTOR_DISABLED/);
  assert.doesNotMatch(s,/await runActor\(/);
});
