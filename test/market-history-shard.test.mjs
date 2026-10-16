import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {verifyMarketHistoryShard} from "../functions/lib/marketHistoryShard.js";
import {onRequestGet,onRequestPost} from "../functions/api/market-history-shard.js";

const ddl=readFileSync(new URL("../sql/shards/market-history-v1.sql",import.meta.url),"utf8");
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(v=>v.toString(16).padStart(2,"0")).join("");
function wrap(db){
 return {prepare(sql){return{
   bind(...args){return {async all(){return {results:db.prepare(sql).all(...args)}}};},
   async all(){return {results:db.prepare(sql).all()}}
 };}};
}
async function fixture(){
 const source=new DatabaseSync(":memory:"),shard=new DatabaseSync(":memory:");
 source.exec(ddl);shard.exec(ddl);
 const insert=(db,id,sourceName)=>{
   db.prepare("INSERT INTO normalized_market_observations(id,observation_key,source,source_type,sport,market_family,collected_at,created_at,raw_payload_json,raw_payload_hash) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id,"key-"+id,sourceName,"exchange","mlb","moneyline","2026-10-16T00:00:00Z","2026-10-16T00:00:00Z",'{"price":0.49}',"a".repeat(64));
 };
 insert(source,"obs1","Polymarket US");insert(shard,"obs1","Polymarket US");
 const cols=source.prepare("PRAGMA table_info(normalized_market_observations)").all().map(x=>x.name);
 assert.equal(cols.length,50);
 const row=source.prepare("SELECT * FROM normalized_market_observations WHERE id='obs1'").get();
 const rowHash=await digest(JSON.stringify(cols.map(k=>row[k])));
 const rawHash=await digest(row.raw_payload_json);
 shard.prepare("INSERT INTO market_history_transfer_evidence(id,source_db,source_rowid,source_payload_sha256,full_row_sha256,pilot_batch,recorded_at) VALUES(?,?,?,?,?,?,?)")
 .run("obs1","b50c724c-903b-4241-8ce1-48d931e7a44c",1,rawHash,rowHash,"FBIS_SHARD_SHADOW_20261016_V1","2026-10-16T00:00:00Z");
 return {source,shard,env:{DB:wrap(source),MARKET_HISTORY_DB:wrap(shard),HARVEST_SECRET:"test-secret"}};
}
test("all-50-column exact content hash pilot passes with no decision authority",async()=>{
 const f=await fixture();
 try{
  const r=await verifyMarketHistoryShard(f.env);
  assert.equal(r.verified,1);assert.equal(r.columnsVerified,50);
  assert.equal(r.canAuthorizeWager,false);assert.equal(r.liveWritesRerouted,false);
  assert.equal(r.productionRowsDeleted,0);
 }finally{f.source.close();f.shard.close();}
});
test("corrupted shard full-row field fails closed",async()=>{
 const f=await fixture();
 try{
  f.shard.prepare("UPDATE normalized_market_observations SET contract_price=0.77 WHERE id='obs1'").run();
  await assert.rejects(verifyMarketHistoryShard(f.env),/CONTENT_HASH_PARITY_FAILED/);
  f.source.prepare("UPDATE normalized_market_observations SET source='PinnOdds' WHERE id='obs1'").run();
  await assert.rejects(verifyMarketHistoryShard(f.env),/SOURCE_IDENTITY_MISMATCH/);
 }finally{f.source.close();f.shard.close();}
});
test("missing shard binding and malformed request fail closed",async()=>{
 const f=await fixture();
 try{
  await assert.rejects(verifyMarketHistoryShard({DB:f.env.DB}),/DATABASE_BINDING_MISSING/);
  await assert.rejects(verifyMarketHistoryShard(f.env,{source:"secret",limit:5}),/SOURCE_OUT_OF_SCOPE/);
  await assert.rejects(verifyMarketHistoryShard(f.env,{limit:500}),/INVALID_LIMIT/);
  const base="https://fbis.test/api/market-history-shard";
  const anon=await onRequestGet({env:f.env,request:new Request(base+"?secret=test-secret")});
  assert.equal(anon.status,403);
  const accepted=await onRequestGet({env:f.env,request:new Request(base,{headers:{"x-harvest-secret":"test-secret"}})});
  assert.equal(accepted.status,200);assert.equal((await accepted.json()).verified,1);
  assert.equal(accepted.headers.get("cache-control"),"private, no-store");
  assert.equal((await onRequestPost()).status,405);
 }finally{f.source.close();f.shard.close();}
});
