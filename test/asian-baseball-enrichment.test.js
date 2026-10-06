import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  kboProviderGameIdParts,providerGameIdIsDoubleheaderSafe,matchKboProviderGame,normalizeKboPlayerObservation,
  priorPitcherState,priorBullpenState,enrichmentShardId,KBO_GAMECENTER_CONTRACT,KBO_PLAYER_HISTORY_CONTRACT
} from "../functions/lib/asianBaseballEnrichment.js";

test("KBO provider game IDs retain game number and stable team identity",()=>{
  const p=kboProviderGameIdParts("20250920SSLG0");
  assert.deepEqual(p,{gameDate:"2025-09-20",awayCode:"SS",homeCode:"LG",gameNo:0,awayTeamId:"kbo-sam",homeTeamId:"kbo-lg"});
  assert.equal(providerGameIdIsDoubleheaderSafe(["20250517OBLG1","20250517OBLG2"]).safe,true);
});
test("provider game reconciliation requires unique canonical candidate and score agreement",()=>{
  const canonical=[{league:"KBO",game_date:"2025-09-20",away_team_id:"kbo-sam",home_team_id:"kbo-lg",away_final_runs:14,home_final_runs:4,venue:"JAMSIL"}];
  const r=matchKboProviderGame({G_ID:"20250920SSLG0",awayScore:14,homeScore:4,stadium:"JAMSIL"},canonical);
  assert.equal(r.status,"MATCH");assert.equal(r.scoreMatch,true);assert.equal(r.confidence,1);
});
test("completed player observations are postgame and never pregame eligible",()=>{
  const o=normalizeKboPlayerObservation({canonicalGameId:"KBO-X",providerGameId:"20250920SSLG0",P_ID:12345,gameDate:"2025-09-20",role:"STARTER",IP:"6.2",TBF:27,NP:101,H:5,HR:1,BB:2,SO:8,R:2,ER:2});
  assert.equal(o.providerPlayerId,"12345");assert.equal(o.inningsOuts,20);assert.equal(o.temporalClass,"POSTGAME");assert.equal(o.pregameEligible,0);
});
test("pitcher state excludes target and later games",()=>{
  const obs=[
    {providerPlayerId:"1",observationRole:"STARTER",completedAt:"2025-09-01T12:00:00Z",inningsOuts:18,battersFaced:24,pitches:90,walks:2,strikeouts:7,homeRunsAllowed:1},
    {providerPlayerId:"1",observationRole:"RELIEVER",completedAt:"2025-09-05T12:00:00Z",inningsOuts:3,battersFaced:4,pitches:15,walks:0,strikeouts:2,homeRunsAllowed:0},
    {providerPlayerId:"1",observationRole:"STARTER",completedAt:"2025-09-10T12:00:00Z",inningsOuts:21,battersFaced:28,pitches:105,walks:3,strikeouts:9,homeRunsAllowed:2}
  ];
  const s=priorPitcherState(obs,"1","2025-09-10T09:00:00Z");
  assert.equal(s.priorAppearances,2);assert.equal(s.priorStarts,1);assert.equal(s.priorReliefAppearances,1);
  assert.equal(s.pitches,105);assert.equal(s.strikeouts,9);assert.equal(s.provenance,"completed prior games only");
});
test("bullpen state uses prior reliever participation only",()=>{
  const obs=[
    {providerPlayerId:"10",teamId:"kbo-lg",observationRole:"RELIEVER",completedAt:"2025-09-19T12:00:00Z",pitches:20,inningsOuts:3},
    {providerPlayerId:"11",teamId:"kbo-lg",observationRole:"RELIEVER",completedAt:"2025-09-21T12:00:00Z",pitches:30,inningsOuts:3}
  ];
  const b=priorBullpenState(obs,"kbo-lg","2025-09-20T09:00:00Z");
  assert.equal(b.knownPriorRelievers,1);assert.equal(b.pitchers[0].providerPlayerId,"10");
  assert.match(b.warning,/later-season/);
});
test("Phase 4B migration is additive and fail closed",async()=>{
  const sql=await readFile(new URL("../migrations/0090_asian_baseball_enrichment_foundation.sql",import.meta.url),"utf8");
  for(const name of ["asian_baseball_game_provider_crosswalk","asian_baseball_player_identities","asian_baseball_player_game_observations","asian_baseball_enrichment_shards"])assert.match(sql,new RegExp(name));
  assert.doesNotMatch(sql,/\bDROP\b|\bDELETE FROM\b/i);
  assert.match(sql,/can_influence_projection INTEGER NOT NULL DEFAULT 0 CHECK\(can_influence_projection=0\)/);
  assert.match(sql,/can_authorize INTEGER NOT NULL DEFAULT 0 CHECK\(can_authorize=0\)/);
  assert.equal(KBO_GAMECENTER_CONTRACT,"KBO_OFFICIAL_GAMECENTER_ENRICHMENT_V1");
  assert.equal(KBO_PLAYER_HISTORY_CONTRACT,"KBO_OFFICIAL_PLAYER_HISTORY_V1");
});

test("bounded enrichment shard IDs are deterministic and player scoped",()=>{
  assert.equal(enrichmentShardId({league:"KBO",provider:"KBO_OFFICIAL",season:2025,providerPlayerId:"65357",dataFamily:"DAILY_HITTER"}),
    "kbo:kbo_official:2025:65357:daily_hitter");
});
