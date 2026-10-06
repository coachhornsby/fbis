import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  durationSeconds,
  parseShiftRows,
  deploymentFromShifts,
} from "../functions/lib/nhlPersistentProfiles.js";

test("NHL historical-state helpers remain reusable and deterministic",()=>{
  assert.equal(durationSeconds("20:15"),1215);
  const roster=[
    {id:"1",position:"C"},{id:"2",position:"L"},{id:"3",position:"R"},
    {id:"4",position:"D"},{id:"5",position:"D"}
  ];
  const payload={data:[
    {teamAbbrev:"BOS",playerId:1,period:1,startTime:"00:00",endTime:"01:00"},
    {teamAbbrev:"BOS",playerId:2,period:1,startTime:"00:00",endTime:"01:00"},
    {teamAbbrev:"BOS",playerId:3,period:1,startTime:"00:00",endTime:"01:00"},
    {teamAbbrev:"BOS",playerId:4,period:1,startTime:"00:00",endTime:"01:00"},
    {teamAbbrev:"BOS",playerId:5,period:1,startTime:"00:00",endTime:"01:00"},
  ]};
  const rows=parseShiftRows(payload,"BOS",new Set(roster.map(x=>x.id)));
  assert.equal(rows.length,5);
  const d=deploymentFromShifts(roster,[{gameId:"g1",rows}]);
  assert.ok(d.lines.get("1"));
  assert.ok(d.pairs.size>0);
});

test("persistent-state challenger is PIT/fail-closed and cannot authorize wagering",async()=>{
  const src=await readFile(new URL("../scripts/nhl-persistent-state-walkforward.mjs",import.meta.url),"utf8");
  assert.match(src,/pointInTime:true/);
  assert.match(src,/marketInformed:false/);
  assert.match(src,/currentScratchState:"UNKNOWN"/);
  assert.match(src,/currentGoalieConfirmation:"UNKNOWN"/);
  assert.match(src,/productionChampion:"NHL-PRO-v2"/);
  assert.match(src,/productionChampionChanged:false/);
  assert.match(src,/canAuthorizeWager:false/);
  assert.match(src,/stakingAuthorized:false/);
  assert.match(src,/FBIS-STATE-OVERLAY-v1/);
  assert.doesNotMatch(src,/heritage|pinnacle|sportsbook.*input/i);
});
