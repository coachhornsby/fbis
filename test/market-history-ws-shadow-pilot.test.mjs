import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {onRequestPost,onRequestGet} from "../functions/api/market-history-ws-shadow-pilot.js";
import {mirrorVerifiedWsObservations} from "../functions/lib/marketHistoryWsShadow.js";

const ddl=readFileSync(new URL("../sql/shards/market-history-v1.sql",import.meta.url),"utf8");
const asDb=(db)=>({prepare:(sql)=>({
 bind(...args){return{async all(){return {results:db.prepare(sql).all(...args)}},
 async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:r.changes}}}};},
 async all(){return{results:db.prepare(sql).all()}}})});
function fixture(){
 const main=new DatabaseSync(":memory:"),shard=new DatabaseSync(":memory:");
 main.exec(ddl);shard.exec(ddl);
 const sql="INSERT INTO normalized_market_observations(id,observation_key,source,source_type,sport,market_family,collected_at,created_at,raw_payload_json,raw_payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?)";
 for(let n=1;n<=8;n++){
  main.prepare(sql).run("nmo_"+n.toString(16).padStart(28,"0"),"key-"+n,
  "Polymarket US WebSocket","exchange","nfl","moneyline",
  "2026-10-16T00:00:00Z","2026-10-16T00:00:00Z",JSON.stringify({price:.4+n/100}),"a".repeat(64));
 }
 return {main,shard,env:{DB:asDb(main),MARKET_HISTORY_DB:asDb(shard),HARVEST_SECRET:"private-test-key"}};
}
const request=(secret,body={operation:"verifyExistingWsRows",limit:8})=>new Request("https://fbis.test/api/market-history-ws-shadow-pilot",{method:"POST",headers:{"content-type":"application/json",...(secret?{"x-harvest-secret":secret}:{})},body:JSON.stringify(body)});
test("one-shot drill mirrors 8 canonical WS rows with full SHA parity; second is idempotent",async()=>{
 const f=fixture();
 try{
  const a=await onRequestPost({env:f.env,request:request("private-test-key")});
  const first=await a.json();
  assert.equal(a.status,200);assert.equal(first.verified,8);assert.equal(first.written,8);
  assert.equal(first.sourceRowsDeleted,0);assert.equal(first.canAuthorizeWager,false);
  assert.equal(first.liveShadowFlagEnabled,false);
  assert.equal(f.main.prepare("SELECT COUNT(*) n FROM normalized_market_observations").get().n,8);
  assert.equal(f.shard.prepare("SELECT COUNT(*) n FROM normalized_market_observations").get().n,8);
  assert.equal(f.shard.prepare("SELECT COUNT(*) n FROM market_history_transfer_evidence WHERE pilot_batch=?")
    .get("FBIS_WS_DUAL_SHADOW_20261016_V1").n,8);
  const b=await onRequestPost({env:f.env,request:request("private-test-key")});
  const second=await b.json();
  assert.equal(second.verified,8);assert.equal(second.written,0);
 } finally{f.main.close();f.shard.close();}
});
test("pilot is never public, cannot activate via query string and refuses arbitrary bodies",async()=>{
 const f=fixture();
 try{
  const anon=await onRequestPost({env:f.env,request:request(null)});
  assert.equal(anon.status,403);
  const queryOnly=await onRequestPost({env:f.env,request:new Request("https://fbis.test/api/market-history-ws-shadow-pilot?harvest_secret=private-test-key",{method:"POST",headers:{"content-type":"application/json"},body:'{"operation":"verifyExistingWsRows","limit":8}'})});
  assert.equal(queryOnly.status,403);
  const wrong=await onRequestPost({env:f.env,request:request("private-test-key",{operation:"verifyExistingWsRows",limit:300})});
  assert.equal(wrong.status,400);
  const missing=await onRequestPost({env:{HARVEST_SECRET:"private-test-key"},request:request("private-test-key")});
  assert.equal(missing.status,503);
  assert.equal((await onRequestGet()).status,405);
  assert.equal(f.shard.prepare("SELECT COUNT(*) n FROM normalized_market_observations").get().n,0);
 }finally{f.main.close();f.shard.close();}
});
test("source modification causing authority change is rejected with zero shard writes",async()=>{
 const f=fixture();
 try{
  f.main.prepare("UPDATE normalized_market_observations SET can_authorize_wager=1 WHERE id=?").run("nmo_"+"8".padStart(28,"0"));
  const response=await onRequestPost({env:f.env,request:request("private-test-key")});
  assert.equal(response.status,409);
  assert.equal(f.shard.prepare("SELECT COUNT(*) n FROM normalized_market_observations").get().n,0);
  await assert.rejects(mirrorVerifiedWsObservations({...f.env,MARKET_HISTORY_SHADOW_WS:"enabled"},["nmo_"+"8".padStart(28,"0")]),/SCOPE_OR_AUTHORITY/);
 }finally{f.main.close();f.shard.close();}
});
