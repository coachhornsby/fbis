import test from "node:test";
import assert from "node:assert/strict";
import {
  CFB_SIM_ID,CFB_SIM_MIN_TRAINING_EVENTS,
  selectCfbSimulationTraining,simulateCfbShadowV1
} from "../functions/lib/cfbSimulationV1.js";
import {freezeCfbShadowEvent,gradeCfbShadowEvent,cfbShadowReport} from "../functions/lib/cfbSimulationStore.js";
import {onRequestPost,onRequestGet} from "../functions/api/cfb-simulation.js";

const target={gameId:"future01",snapshotId:"future-snap",modelVersion:"CFB-FBIS-v2",
 frozenAt:"2026-10-21T18:00:00Z",kickoff:"2026-10-24T18:00:00Z",projectedHome:29.3,projectedAway:20.7};
const prior=(i,overrides={})=>({
  gameId:"old-"+i,snapshotId:"historical-"+i,modelVersion:"CFB-FBIS-v2",
  projectionKind:"FBIS",frozenAt:"2026-10-11T12:00:00Z",
  kickoff:"2026-10-12T12:00:00Z",gradedAt:"2026-10-13T02:00:00Z",
  projectedHome:30+i%7,projectedAway:20+i%4,
  actualHome:24+i%18,actualAway:14+i%15,...overrides,
});
const history=Array.from({length:80},(_,i)=>prior(i));
test("CFB training is strictly point-in-time, deduplicated by game and version",()=>{
 const extra=[
   prior(0,{snapshotId:"newer-pre",frozenAt:"2026-10-11T15:00:00Z"}),
   prior(999,{gradedAt:"2026-10-22T02:00:00Z"}),
   prior(998,{frozenAt:"2026-10-12T14:00:00Z"}),
   prior(997,{modelVersion:"CFB-FBIS-v1"}),
   prior(996,{gameId:target.gameId}),
   prior(995,{kickoff:"2026-10-24T18:00:00Z",gradedAt:"2026-10-25T01:00:00Z"}),
 ];
 const x=selectCfbSimulationTraining([...history,...extra],{
  modelVersion:target.modelVersion,targetFrozenAt:target.frozenAt,targetGameId:target.gameId,
 });
 assert.equal(x.games,80);
 assert.equal(x.rows.find(r=>r.gameId==="old-0").snapshotId,"newer-pre");
 assert.equal(x.excluded.FUTURE_OR_POST_START_EVIDENCE,3);
 assert.equal(x.excluded.MODEL_MISMATCH,1);
 assert.equal(x.excluded.SAME_EVENT,1);
});
test("CFB simulator is seeded and internally coherent, with no production authority",()=>{
 const params={...target,historicalRows:history,iterations:200};
 const a=simulateCfbShadowV1(params),b=simulateCfbShadowV1(params);
 assert.deepEqual(a,b);
 assert.equal(a.trainingCount,80);
 assert.equal(a.iterations,200);
 assert.equal(a.sourceDb,"CFB_DB");
 assert.equal(a.distributions.margin.n,200);
 assert.equal(a.distributions.tie.n,200);
 assert.equal(a.homeAheadFrequency+a.tieFrequency<=1,true);
 assert.equal(a.canAuthorizeWager,false);
 assert.equal(a.canQualify,false);
 assert.equal(a.changesProductionChampion,false);
 assert.equal(a.semantics,"CORRELATED_SCORE_RESIDUALS_NOT_PLAY_BY_PLAY_OR_MONEYLINE");
});
test("CFB fails closed when future outcomes are smuggled into training",()=>{
 const leaked=history.map(r=>({...r,gradedAt:"2026-10-23T00:00:00Z"}));
 assert.throws(()=>simulateCfbShadowV1({...target,historicalRows:leaked,iterations:100}),/INSUFFICIENT_POINT_IN_TIME/);
 assert.throws(()=>simulateCfbShadowV1({...target,historicalRows:history.slice(0,CFB_SIM_MIN_TRAINING_EVENTS-1),iterations:100}),/INSUFFICIENT_POINT_IN_TIME/);
 assert.throws(()=>simulateCfbShadowV1({...target,historicalRows:history,modelVersion:"CFB-FBIS-v3",iterations:100}),/UNSUPPORTED_CFB_CHAMPION/);
 assert.throws(()=>simulateCfbShadowV1({...target,historicalRows:history,frozenAt:target.kickoff,iterations:100}),/NOT_FROZEN_PREGAME/);
});
test("no CFB DB means no simulation write or report; no fallback to primary",async()=>{
 await assert.rejects(freezeCfbShadowEvent({DB:{prepare(){throw Error("PRIMARY_USED")}}},{gameId:target.gameId}),/CFB_DB_UNBOUND/);
 await assert.rejects(gradeCfbShadowEvent({DB:{prepare(){throw Error("PRIMARY_USED")}}},{gameId:target.gameId}),/CFB_DB_UNBOUND/);
 await assert.rejects(cfbShadowReport({DB:{prepare(){throw Error("PRIMARY_USED")}}}),/CFB_DB_UNBOUND/);
});
test("operator action requires header secret and rejects arbitrary actions",async()=>{
 const env={HARVEST_SECRET:"local-test-token"};
 const get=await onRequestGet({request:new Request("https://example.test/api/cfb-simulation"),env});
 assert.equal(get.status,401);
 const noAuth=await onRequestPost({request:new Request("https://example.test/api/cfb-simulation",{
 method:"POST",body:JSON.stringify({action:"freeze",gameId:"x"})}),env});
 assert.equal(noAuth.status,401);
 const unknown=await onRequestPost({request:new Request("https://example.test/api/cfb-simulation",{
 method:"POST",headers:{"x-harvest-secret":"local-test-token"},
 body:JSON.stringify({action:"promote",gameId:"x"})}),env});
 assert.equal(unknown.status,400);
 const unbound=await onRequestPost({request:new Request("https://example.test/api/cfb-simulation",{
 method:"POST",headers:{"x-harvest-secret":"local-test-token"},
 body:JSON.stringify({action:"freeze",gameId:"x"})}),env});
 assert.equal(unbound.status,503);
});
