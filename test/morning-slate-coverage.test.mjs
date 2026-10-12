import test from "node:test";
import assert from "node:assert/strict";
import {chicagoDate,utcStamp,missingScheduledIds,checkCoverage,ENABLED_SPORTS} from "../scripts/morning-slate-coverage.mjs";

test("Chicago game date follows DST and UTC midnight boundaries",()=>{
  assert.equal(chicagoDate("2026-10-13T00:15:00Z"),"2026-10-12");
  assert.equal(chicagoDate("2026-11-02T01:00:00Z"),"2026-11-01");
  assert.equal(chicagoDate("nonsense"),null);
  assert.equal(utcStamp("2026-10-12",-1),"20261011");
  assert.equal(utcStamp("2026-10-12",1),"20261013");
});
test("missing ESPN scheduled games are fail-closed, not mistaken for model passes",()=>{
  const schedule=[{id:"1"},{id:"2"}];
  const b=[{id:"1",projection:{independent:true}}];
  const c=checkCoverage("nhl",b,schedule);
  assert.deepEqual(c.missingEventIds,["2"]);
  assert.equal(c.state,"INCOMPLETE");
  assert.equal(c.independentModels,1);
});
test("known games with unavailable projections remain tracked but unmodeled",()=>{
  const board=[{id:"1",projection:{independent:false}},{id:"2"}];
  const c=checkCoverage("nba",board,[{id:"1"},{id:"2"}]);
  assert.equal(c.state,"COMPLETE");
  assert.equal(c.unavailableModels,2);
  assert.equal(c.independentModels,0);
});
test("zero unsupported-sport games must not be labeled verified no slate",()=>{
  const c=checkCoverage("soccer",[],null);
  assert.equal(c.state,"BOARD_ONLY");
  assert.equal(c.sourceStatus,"SOURCE_UNVERIFIED");
  assert.equal(c.expectedGames,null);
});
test("duplicate provider event ids are flagged",()=>{
  const board=[{id:"7",projection:{independent:true}},{id:"7",projection:{independent:true}}];
  assert.deepEqual(checkCoverage("mlb",board,[{id:"7"}]).duplicateIds,["7"]);
  assert.deepEqual(missingScheduledIds([{id:"7"},{id:"8"},{id:"8"}],board),["8"]);
});
test("enabled sports include every scheduled export league",()=>{
  assert.equal(new Set(ENABLED_SPORTS).size,10);
  for(const sport of ["mlb","nfl","nhl","nba","soccer","wnba","npb","kbo","cfb","cbb"]){
    assert.ok(ENABLED_SPORTS.includes(sport));
  }
});
