import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("PrizePicks workflow has redundant guarded morning schedules and no push trigger",()=>{
  const y=fs.readFileSync(".github/workflows/prizepicks-targeted-props.yml","utf8");
  assert.match(y,/cron: "5 13 \* \* \*"/);
  assert.match(y,/cron: "35 13 \* \* \*"/);
  assert.match(y,/cron: "5 14 \* \* \*"/);
  assert.doesNotMatch(y,/\n\s+push:/);
  assert.match(y,/Reserve today's single paid PrizePicks acquisition/);
  assert.match(y,/Pull full PrizePicks board once/);
  assert.doesNotMatch(y,/playerNames:\$players/);
});
test("PrizePicks API enforces durable daily acquisition reservation",()=>{
  const s=fs.readFileSync("functions/api/prizepicks-props.js","utf8");
  assert.match(s,/ALREADY_COLLECTED_TODAY/);
  assert.match(s,/prizepicks_daily_acquisitions/);
  assert.match(s,/ESTIMATED_START/);
});
test("legacy paid collector is disabled",()=>{
  const s=fs.readFileSync("functions/api/prizepicks-collect.js","utf8");
  assert.match(s,/LEGACY_PRIZEPICKS_COLLECTOR_DISABLED/);
  assert.doesNotMatch(s,/await runActor\(/);
});
