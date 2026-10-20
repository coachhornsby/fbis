import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const path=new URL("../services/polymarket-us-stream/worker.mjs",import.meta.url);
async function getWorker(){
 let code=readFileSync(path,"utf8");
 code=code.replace('import {DurableObject} from "cloudflare:workers";',
   'class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }');
 code=code.replace('import {persistNormalizedMarketBatch} from "../../functions/lib/marketObservationLedger.js";',
   'const persistNormalizedMarketBatch=async()=>({inserted:3,ids:globalThis.__marketShadowTestIds});');
 code=code.replace('import {mirrorPersistentStreamRows} from "./shadow.mjs";',
   'const mirrorPersistentStreamRows=async(_env,ids)=>globalThis.__marketShadowTestMirror(ids);');
 code=code.replace(/from\s+["'](\.[^"']+)["']/g,(_,relative)=>"from "+JSON.stringify(new URL(relative,path).href));
 return (await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"))).PolymarketMarketStream;
}
test("failed secondary mirror preserves canonical write and durable retry backlog",async()=>{
 const Stream=await getWorker();
 const persist=new Map(),storage={
  async get(key){return persist.get(key)},
  async put(key,value){persist.set(key,structuredClone(value));},
  async setAlarm(){}
 };
 const ctx={storage,waitUntil(){}};
 // Q4 must be bound (fail-closed topology). Primary-first keeps this test on the
 // mocked canonical insert path while still satisfying the Q4 gate.
 const q4={prepare(){return{bind(){return{async run(){return{meta:{changes:0}}},async all(){return{results:[]}},async first(){return null}}}}}};
 const env={
  MARKET_HISTORY_SHADOW_WS:"enabled",
  STREAM_WS_PERSIST_PRIMARY:"enabled",
  MARKET_HISTORY_2026Q4_DB:q4,
  DB:{prepare(){return{bind(){return{async run(){return{meta:{changes:1}}},async all(){return{results:[{healthy:1}],meta:{size_after:1_000}}},async first(){return null}}}}}},
 };
 globalThis.__marketShadowTestIds=[1,2,3].map(i=>"nmo_"+i.toString(16).padStart(28,"0"));
 let attempts=0;
 globalThis.__marketShadowTestMirror=async(ids)=>{
  attempts++; if(attempts===1)throw Error("simulated shard unavailability");
  return {state:"SHADOW_VERIFIED",verified:ids.length,written:ids.length,sourceRowsDeleted:0};
 };
 let first=null,second=null;
 try{
  first=new Stream(ctx,env);
  const tick={marketSlug:"soccer-draw",bestAsk:0.27,sourceObservedAt:"2026-10-16T11:00:00Z",at:"2026-10-16T11:00:01Z"};
  first.subscribed.set("soccer-draw",{sport:"soccer",canonical_event_id:"game",event_start_time:"2026-10-17T14:00:00Z",market_family:"moneyline",period:"full_game",side:"Draw"});
  first.queue.set("soccer-draw",tick);
  await first.flush();
  assert.equal(first.inserted,3,"canonical commit remains successful");
  assert.equal(first.lastError,null,"shadow error cannot masquerade as primary write failure");
  assert.equal(first.shadowPendingIds.length,3);
  assert.equal(persist.get("marketShadowPendingIds").length,3);
  assert.equal(first.shadowFailed,1);
  second=new Stream(ctx,env);
  await second.flush(); // no new ticks; must still reconcile persisted shadow backlog
  assert.equal(second.inserted,0);
  assert.equal(second.shadowVerified,3);
  assert.equal(second.shadowPendingIds.length,0);
  assert.deepEqual(persist.get("marketShadowPendingIds"),[]);
  assert.equal(second.lastShadowError,null);
  assert.equal(attempts,2);
 }finally{
  for(const w of [first,second]){
   if(w?.flushTimer){clearTimeout(w.flushTimer);w.flushTimer=null;}
  }
  delete globalThis.__marketShadowTestIds;
  delete globalThis.__marketShadowTestMirror;
 }
});
