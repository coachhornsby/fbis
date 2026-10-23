import test from "node:test";
import assert from "node:assert/strict";
import {pendingCfbRankingReplays,replayCfbRankingMetrics}
  from "../functions/lib/cfbDriveRankingReplay.js";
import {onRequestPost,onRequestGet} from "../functions/api/cfb-simulation.js";
test("Replays are never sourced from shared primary D1 and require CFB sport binding",async()=>{
 await assert.rejects(pendingCfbRankingReplays({DB:{prepare(){throw Error("PRIMARY_WRONG")}}}),/CFB_DB_UNBOUND/);
 await assert.rejects(replayCfbRankingMetrics({DB:{prepare(){throw Error("PRIMARY_WRONG")}}},{runId:"run-1"}),/CFB_DB_UNBOUND/);
});
test("Pending list is operator-only and lists only unbackfilled, immutably frozen v2 research",async()=>{
 let sql="",bind=[];
 const env={CFB_DB:{prepare(q){sql=q;return{bind(...args){bind=args;return{
   all:async()=>({results:[{gameId:"123",runId:"r"}]})}}}}}};
 const p=await pendingCfbRankingReplays(env);
 assert.equal(p.pending.length,1);
 assert.equal(p.canAuthorizeWager,false);
 assert.match(sql,/LEFT JOIN cfb_drive_rankings_enrichment/);
 assert.match(sql,/r\.can_authorize_wager=0/);
 assert.equal(bind[0],"CFB-DRIVE-STATE-SHADOW-v2");
});
test("Unauthenticated operator replays cannot access raw CFBD history or persistent results",async()=>{
 const env={CFB_DB:{prepare(){throw Error("DB SHOULD NOT BE QUERIED")}},HARVEST_SECRET:"sample-offline"};
 const get=new Request("https://fbis.test/api/cfb-simulation?mode=ranking-replay-pending");
 const post=new Request("https://fbis.test/api/cfb-simulation",{
  method:"POST",body:JSON.stringify({action:"drive-ranking-replay",runId:"run-1"})});
 assert.equal((await onRequestGet({request:get,env})).status,401);
 assert.equal((await onRequestPost({request:post,env})).status,401);
});
test("Incompatible or unverified historical source records are rejected before replay",async()=>{
 const no={CFB_DB:{prepare(sql){return{bind(){return{first:async()=>null}}}}}};
 await assert.rejects(replayCfbRankingMetrics(no,{runId:"bad id #"}),/INVALID_CFB_REPLAY_RUN_ID/);
 await assert.rejects(replayCfbRankingMetrics(no,{runId:"RESEARCH_ASOF:2026-10-22:1|CFB-DRIVE-STATE-SHADOW-v2"}),/CFB_RANKING_ORIGINAL_RUN_NOT_VERIFIED/);
});
