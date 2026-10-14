import test from "node:test";
import assert from "node:assert/strict";
import {extractEspnTennisFixtures,captureEspnTennisSchedule} from "../functions/lib/tennisExternalSchedule.js";
const clock="2026-10-14T04:00:00.000Z";
const body={events:[{id:"t100",date:"2026-10-14T00:00:00Z",competitions:[
 {id:"m1",date:"2026-10-14T18:00:00Z",status:{type:{state:"pre"}},
  competitors:[{athlete:{displayName:"Elsa Jacquemot"}},{athlete:{displayName:"Teodora Kostović"}}]},
 {id:"m2",date:"2026-10-15T19:00:00Z",status:{type:{state:"pre"}},
  competitors:[{athlete:{displayName:"Coco Gauff"}},{athlete:{displayName:"Jessica Pegula"}}]},
 {id:"m3",date:null,competitors:[{athlete:{displayName:"Xiyu Wang"}},{athlete:{displayName:"Mia Pohankova"}}]},
 {id:"doubles",date:"2026-10-14T20:00:00Z",competitors:[
  {athlete:{displayName:"Jane Doe / Alice Doe"}},{athlete:{displayName:"Another One / Partner Two"}}]}
]}]};
test("ESPN independent schedule captures two distinct verified singles, not tournament fallback or doubles",()=>{
 const result=extractEspnTennisFixtures(body,{tour:"wta",fetchedAt:clock});
 assert.equal(result.rows.length,2);
 assert.equal(result.rows[0].fixtureId,"tennis:espn:wta:t100:m1");
 assert.equal(result.rows[0].player2Name,"Teodora Kostović");
 assert.equal(result.reasons.MATCH_TIME_UNVERIFIED,1);
 assert.equal(result.reasons.PLAYER_IDENTITY_UNVERIFIED,1);
});
test("unsupported ESPN response shape fails closed",()=>{
 assert.throws(()=>extractEspnTennisFixtures({items:[]},{tour:"atp",fetchedAt:clock}),/CONTRACT_CHANGED/);
 assert.throws(()=>extractEspnTennisFixtures(body,{tour:"itf",fetchedAt:clock}),/CONTEXT/);
});
test("raw source archive precedes any database writes, and flags remain research-only",async()=>{
 const activity=[],archive=new Map();
 const env={ARCHIVE:{async put(key,raw){archive.set(key,raw);activity.push("archive")}},
 DB:{prepare(sql){assert.match(sql,/ON CONFLICT\(fixture_id\)/);return{
  bind(...v){assert.equal(v[1],"ESPN_PUBLIC");return{async run(){activity.push("persist");return{meta:{changes:1}}}}}
 }}}};
 const result=await captureEspnTennisSchedule(env,{tour:"wta",date:"20261014",
  now:new Date(clock),fetchImpl:async(url)=>{
   assert.ok(url.endsWith("/tennis/wta/scoreboard?dates=20261014"));
   return new Response(JSON.stringify(body),{status:200});
  }});
 assert.equal(result.verifiedFixtures,2);assert.equal(result.persisted,2);
 assert.deepEqual(activity,["archive","persist","persist"]);
 assert.equal(result.officialSourceVerified,false);
 assert.equal(result.canQualify,false);assert.equal(result.canAuthorizeWager,false);
 assert.ok(archive.has(result.rawKey));
});
test("cannot request unbounded date windows or invalid tours",async()=>{
 await assert.rejects(captureEspnTennisSchedule({ARCHIVE:{put(){}},DB:{prepare(){}}},{tour:"atp",date:"20261201",now:new Date(clock)}),/OUTSIDE_ALLOWED_WINDOW/);
 await assert.rejects(captureEspnTennisSchedule({ARCHIVE:{put(){}},DB:{prepare(){}}},{tour:"tennis",date:"20261014",now:new Date(clock)}),/INVALID_SOURCE_SCOPE/);
});
