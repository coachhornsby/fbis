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
 const env={MARKET_HISTORY_SHADOW_WS:"enabled",DB:{}};
 globalThis.__marketShadowTestIds=[1,2,3].map(i=>"nmo_"+i.toString(16).padStart(28,"0"));
 let attempts=0;
 globalThis.__marketShadowTestMirror=async(ids)=>{
  attempts++; if(attempts===1)throw Error("simulated shard unavailability");
  return {state:"SHADOW_VERIFIED",verified:ids.length,written:ids.length,sourceRowsDeleted:0};
 };
 try{
  const first=new Stream(ctx,env);
  const tick={marketSlug:"soccer-draw",bestAsk:0.27,sourceObservedAt:"2026-10-16T11:00:00Z",at:"2026-10-16T11:00:01Z"};
  first.subscribed.set("soccer-draw",{sport:"soccer",canonical_event_id:"game",event_start_time:"2026-10-17T14:00:00Z",market_family:"moneyline",period:"full_game",side:"Draw"});
  first.queue.set("soccer-draw",tick);
  await first.flush();
  assert.equal(first.inserted,3,"canonical commit remains successful");
  assert.equal(first.lastError,null,"shadow error cannot masquerade as primary write failure");
  assert.equal(first.shadowPendingIds.length,3);
  assert.equal(persist.get("marketShadowPendingIds").length,3);
  assert.equal(first.shadowFailed,1);
  const second=new Stream(ctx,env);
  await second.flush(); // no new ticks; must still reconcile persisted shadow backlog
  assert.equal(second.inserted,0);
  assert.equal(second.shadowVerified,3);
  assert.equal(second.shadowPendingIds.length,0);
  assert.deepEqual(persist.get("marketShadowPendingIds"),[]);
  assert.equal(second.lastShadowError,null);
  assert.equal(attempts,2);
 }finally{
  delete globalThis.__marketShadowTestIds;
  delete globalThis.__marketShadowTestMirror;
 }
});
