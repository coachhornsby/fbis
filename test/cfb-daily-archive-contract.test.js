import test from "node:test";
import assert from "node:assert/strict";
import {persistObservation} from "../functions/lib/collegeJobsCore.js";
function fixture({missingTable=true,failArchive=false}={}){
 const writes=[];
 const env={
  DB:{prepare(sql){return {bind(){return {async run(){
    if(missingTable)throw Error("D1 7500: no such table: source_observations");
    return {meta:{changes:1}};
   }}}}}},
  ARCHIVE:{get:async()=>null,async put(key,body){if(failArchive)throw Error("R2 failing");writes.push({key,body});}}
 };
 return {env,writes};
}
const source={source:"cfbd",sport:"cfb",endpoint:"/games/teams",season:2026,
 partition:"2026-10-13",data:[{id:40001,teams:[
  {team:"Test A",stats:[{category:"rushing",stat:"132"}]},
  {team:"Test B",stats:[{category:"rushing",stat:"65"}]}
 ]}],jobRunId:"test-collector",archiveFullPayload:true};
test("CFBD daily source persists complete stats to R2 when legacy D1 pointer table is absent",async()=>{
 const {env,writes}=fixture();
 const a=await persistObservation(env,source);
 assert.equal(a.ok,true);
 assert.equal(a.storage,"R2_RAW_JOB_MANIFEST");
 assert.equal(a.legacyPointerTableUnavailable,true);
 assert.equal(a.canAuthorizeWager,false);
 assert.match(a.r2Key,/raw\/cfbd\/cfb\/2026\/games_teams\/2026-10-13/);
 assert.deepEqual(JSON.parse(writes[0].body),source.data);
 assert.equal((await persistObservation(env,source)).r2Key,a.r2Key);
 assert.equal(writes.length,2);
});
test("CFBD daily source saves D1 audit pointer where installed",async()=>{
 const {env,writes}=fixture({missingTable:false});
 const r=await persistObservation(env,source);
 assert.equal(r.ok,true);assert.equal(r.storage,"R2_RAW_AND_D1_POINTER");
 assert.equal(r.inserted,1);assert.equal(writes.length,1);
});
test("raw archival failure cannot falsely report successful ingestion",async()=>{
 await assert.rejects(persistObservation(fixture({failArchive:true}).env,source),
  /CFBD_DAILY_ARCHIVE_WRITE_FAILED/);
 const env={DB:fixture().env.DB};
 await assert.rejects(persistObservation(env,source),/CFBD_DAILY_RAW_ARCHIVE_REQUIRED/);
});
