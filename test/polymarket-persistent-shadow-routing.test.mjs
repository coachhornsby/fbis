import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mirrorPersistentStreamRows,STREAM_SHADOW_CHUNK} from "../services/polymarket-us-stream/shadow.mjs";
const ids=Array.from({length:40},(_,i)=>"nmo_"+i.toString(16).padStart(28,"0"));
test("persistent stream mirror is off without explicit opt-in",async()=>{
 let called=false;
 const r=await mirrorPersistentStreamRows({},ids,{mirror:async()=>{called=true;}});
 assert.equal(r.state,"OFF");assert.equal(called,false);
});
test("persistent service mirrors all 40 canonical rows, chunks at 16 and never drops the tail",async()=>{
 const size=[];
 const r=await mirrorPersistentStreamRows({MARKET_HISTORY_SHADOW_WS:"enabled"},ids,{
  mirror:async(_env,chunk)=>{size.push(chunk.length);return {state:"SHADOW_VERIFIED",verified:chunk.length,written:chunk.length,sourceRowsDeleted:0};}
 });
 assert.deepEqual(size,[16,16,8]);assert.equal(r.verified,40);assert.equal(r.written,40);
 assert.equal(r.sourceRowsDeleted,0);assert.equal(r.primaryIsAuthoritative,true);
 assert.equal(STREAM_SHADOW_CHUNK,16);
});
test("partial parity and scope errors fail closed, no silent positive authority",async()=>{
 const enabled={MARKET_HISTORY_SHADOW_WS:"enabled"};
 for(const list of [[],ids.concat(ids[0]),["foo"]]){
  await assert.rejects(mirrorPersistentStreamRows(enabled,list),/STREAM_SHADOW_INVALID_IDS/);
 }
 await assert.rejects(mirrorPersistentStreamRows(enabled,ids,{
  mirror:async(_env,chunk)=>({state:"SHADOW_VERIFIED",verified:chunk.length-1,written:0,sourceRowsDeleted:0})
 }),/STREAM_SHADOW_PARITY_FAILURE/);
});
test("Durable Object stream carries backed-up post-commit shadow queue and operator-visible lag",()=>{
 const code=readFileSync(new URL("../services/polymarket-us-stream/worker.mjs",import.meta.url),"utf8");
 assert.match(code,/mirrorPersistentStreamRows/);
 assert.match(code,/marketShadowPendingIds/);
 assert.match(code,/await this\.ctx\.storage\.put\("marketShadowPendingIds"/);
 assert.match(code,/await this\.queueCommittedShadow\(r\.ids\)/);
 assert.match(code,/shadow:\{enabled:/);
 assert.match(code,/this\.shadowGap\+=/);
 assert.match(code,/if\(!this\.queue\.size\)\{await this\.drainShadow\(\);return;\}/);
 assert.match(code,/shadow-queue-unavailable/);
});
