import test from "node:test";
import assert from "node:assert/strict";
import {freezeCfbDriveResearchAsOf,CFB_RESEARCH_ASOF_MODE} from "../functions/lib/cfbDriveResearchAsOf.js";
import {onRequestPost} from "../functions/api/cfb-simulation.js";

test("As-of mode openly identifies reused earlier champion baseline",()=>{
 assert.equal(CFB_RESEARCH_ASOF_MODE,"NEW_RESEARCH_OBSERVATION_EARLIER_CHAMPION_BASELINE");
});
test("As-of CFB research does not fall back to PRIMARY D1",async()=>{
 const env={DB:{prepare(){throw Error("PRIMARY_DB_WAS_USED")}}};
 await assert.rejects(freezeCfbDriveResearchAsOf(env,{gameId:"401856727"}),/CFB_DB_UNBOUND/);
});
test("Only operator-authenticated research action can run",async()=>{
 const env={HARVEST_SECRET:"offline-only-secret"};
 const request=(secret)=>new Request("https://fbis.test/api/cfb-simulation",{
   method:"POST",headers:secret?{"x-harvest-secret":secret}:{},
   body:JSON.stringify({action:"drive-research-asof",gameId:"401856727"})
 });
 assert.equal((await onRequestPost({request:request(null),env})).status,401);
 assert.equal((await onRequestPost({request:request("offline-only-secret"),env})).status,503);
});
test("As-of collection refuses invalid game identity and iteration changes",async()=>{
 await assert.rejects(freezeCfbDriveResearchAsOf({CFB_DB:{prepare(){throw Error("MUST_NOT_QUERY")}}},{gameId:"not a game"}),/INVALID_GAME_ID/);
 await assert.rejects(freezeCfbDriveResearchAsOf({CFB_DB:{prepare(){return {all:async()=>({results:[{name:"cfb_drive_shadow_runs"},{name:"cfb_drive_verified_games"}]})}}}},{gameId:"401856727",iterations:10000}),/RESEARCH_ITERATION_LIMIT/);
});
