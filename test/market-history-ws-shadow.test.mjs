import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {mirrorVerifiedWsObservations} from "../functions/lib/marketHistoryWsShadow.js";
const schema=readFileSync(new URL("../sql/shards/market-history-v1.sql",import.meta.url),"utf8");
const id="nmo_"+"a".repeat(28);
const source="Polymarket US WebSocket";
function wrap(db){return {prepare(sql){return{
 bind(...args){return{
  async all(){return{results:db.prepare(sql).all(...args)}},
  async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:r.changes}}}
 }},
 async all(){return{results:db.prepare(sql).all()}}
}}}}
function fixture(){
 const main=new DatabaseSync(":memory:"),shard=new DatabaseSync(":memory:");
 main.exec(schema);shard.exec(schema);
 main.prepare("INSERT INTO normalized_market_observations(id,observation_key,source,source_type,sport,market_family,collected_at,created_at,raw_payload_json,raw_payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?)")
 .run(id,"key-1",source,"exchange","nfl","moneyline","2026-10-16T01:00:00Z","2026-10-16T01:00:00Z",'{"quote":"yes","price":0.45}',"a".repeat(64));
 return {main,shard,env:{DB:wrap(main),MARKET_HISTORY_DB:wrap(shard),MARKET_HISTORY_SHADOW_WS:"disabled"}};
}
test("default-off WebSocket mirror never reads or writes either database",async()=>{
 const f=fixture();
 try{
  const r=await mirrorVerifiedWsObservations(f.env,[id]);
  assert.equal(r.state,"OFF");assert.equal(f.shard.prepare("SELECT COUNT(*) n FROM normalized_market_observations").get().n,0);
 }finally{f.main.close();f.shard.close();}
});
test("opt-in source-row mirror is lossless and idempotent across all 50 source columns",async()=>{
 const f=fixture();
 try{
  f.env.MARKET_HISTORY_SHADOW_WS="enabled";
  const a=await mirrorVerifiedWsObservations(f.env,[id]);
  assert.deepEqual([a.attempted,a.written,a.verified],[1,1,1]);
  assert.equal(a.primaryIsAuthoritative,true);
  assert.equal(a.canAuthorizeWager,false);
  const rows=f.shard.prepare("SELECT * FROM normalized_market_observations").all();
  assert.equal(rows.length,1);
  const e=f.shard.prepare("SELECT * FROM market_history_transfer_evidence").get();
  assert.equal(e.pilot_batch,"FBIS_WS_DUAL_SHADOW_20261016_V1");
  assert.equal(e.source_db,"b50c724c-903b-4241-8ce1-48d931e7a44c");
  const b=await mirrorVerifiedWsObservations(f.env,[id]);
  assert.deepEqual([b.written,b.verified],[0,1]);
  assert.equal(f.main.prepare("SELECT COUNT(*) n FROM normalized_market_observations").get().n,1);
 }finally{f.main.close();f.shard.close();}
});
test("tampered target, changed authority, missing binding and invalid scope fail closed",async()=>{
 const f=fixture();f.env.MARKET_HISTORY_SHADOW_WS="enabled";
 try{
  await assert.rejects(mirrorVerifiedWsObservations({...f.env,MARKET_HISTORY_DB:null},[id]),/BINDING_MISSING/);
  await assert.rejects(mirrorVerifiedWsObservations(f.env,[]),/INVALID_ID_SCOPE/);
  await assert.rejects(mirrorVerifiedWsObservations(f.env,Array.from({length:17},()=>id)),/INVALID_ID_SCOPE/);
  await mirrorVerifiedWsObservations(f.env,[id]);
  f.shard.prepare("UPDATE normalized_market_observations SET raw_payload_json='{}' WHERE id=?").run(id);
  await assert.rejects(mirrorVerifiedWsObservations(f.env,[id]),/SHARD_CONTENT_PARITY/);
  f.main.prepare("UPDATE normalized_market_observations SET can_authorize_wager=1 WHERE id=?").run(id);
  await assert.rejects(mirrorVerifiedWsObservations(f.env,[id]),/SCOPE_OR_AUTHORITY/);
 }finally{f.main.close();f.shard.close();}
});
