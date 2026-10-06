import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("NHL state ablation produces a PIT research artifact without wager authority",()=>{
  const out="/tmp/nhl-state-research-v1.json";
  const r=spawnSync(process.execPath,["scripts/nhl-state-research-v1.mjs","--source=data/models/nhl-pro-v2-validation.json",`--out=${out}`],{encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
  return readFile(out,"utf8").then(raw=>{
    const j=JSON.parse(raw);
    assert.equal(j.modelId,"NHL-STATE-RESEARCH-v1");
    assert.equal(j.pointInTime,true);
    assert.equal(j.marketInformed,false);
    assert.ok(j.sampleGames>=2500);
    assert.equal(j.governance.canPromoteAutomatically,false);
    assert.equal(j.governance.canAuthorizeWager,false);
    assert.equal(j.governance.stakingAuthorized,false);
    assert.ok(j.aggregate.full_v2);
    assert.ok(j.aggregate.no_goalie);
    assert.ok(j.aggregate.no_schedule_rest);
  });
});
