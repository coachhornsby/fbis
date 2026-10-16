import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {onRequestGet,onRequestPost} from "../functions/api/market-history-ws-health.js";
const ddl=readFileSync(new URL("../sql/shards/market-history-v1.sql",import.meta.url),"utf8");
function wrap(db){return{prepare(sql){return{
  bind(...args){return {async all(){return{results:db.prepare(sql).all(...args)}}}},
  async all(){return{results:db.prepare(sql).all()}}
}}}}
function fixture(){
 const a=new DatabaseSync(":memory:"),b=new DatabaseSync(":memory:");
 a.exec(ddl);b.exec(ddl);
 const insert=db=>{const q=db.prepare("INSERT INTO normalized_market_observations(id,observation_key,source,source_type,sport,market_family,collected_at,created_at,raw_payload_json,raw_payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?)");
 for(let i=0;i<8;i++){const n=(i+1).toString(16).padStart(28,"0");q.run("nmo_"+n,"hash-"+n,"Polymarket US WebSocket","exchange","mlb","moneyline","2026-10-16T14:00:00Z","2026-10-16T14:00:00Z",'{"price":0.5}',"hash");}};
 insert(a);insert(b);
 return {a,b,env:{DB:wrap(a),MARKET_HISTORY_DB:wrap(b),HARVEST_SECRET:"known",MARKET_HISTORY_SHADOW_WS:"enabled"}};
}
const req=(secret)=>new Request("https://fbis.test/api/market-history-ws-health",{headers:secret?{"x-harvest-secret":secret}:{}});
test("secure health monitor independently verifies 8 complete immutable source rows",async()=>{
 const f=fixture();
 try{
  assert.equal((await onRequestGet({env:f.env,request:req(null)})).status,403);
  const r=await onRequestGet({env:f.env,request:req("known")}),body=await r.json();
  assert.equal(r.status,200);assert.equal(body.verified,8);assert.equal(body.missing,0);
  assert.equal(body.continuousShadowEnabled,true);assert.equal(body.canAuthorizeWager,false);
  assert.equal((await onRequestPost()).status,405);
  assert.equal(f.a.prepare("SELECT COUNT(*) n FROM normalized_market_observations").get().n,8);
 }finally{f.a.close();f.b.close();}
});
test("missing and tampered rows fail closed; no shard write or primary mutation",async()=>{
 const f=fixture();try{
  f.b.prepare("DELETE FROM normalized_market_observations WHERE id=?").run("nmo_"+"1".padStart(28,"0"));
  let r=await onRequestGet({env:f.env,request:req("known")});let b=await r.json();
  assert.equal(r.status,503);assert.equal(b.missing,1);
  f.b.prepare("UPDATE normalized_market_observations SET raw_payload_json='{}' WHERE id=?").run("nmo_"+"2".padStart(28,"0"));
  r=await onRequestGet({env:f.env,request:req("known")});b=await r.json();
  assert.equal(r.status,503);assert.equal(b.mismatched,1);
  assert.equal((await onRequestGet({env:{HARVEST_SECRET:"known"},request:req("known")})).status,503);
 }finally{f.a.close();f.b.close();}
});
test("deployment manifest opts into WS-only mirror without changing canonical DB binding",()=>{
 const c=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
 assert.match(c,/MARKET_HISTORY_SHADOW_WS = "enabled"/);
 assert.match(c,/binding = "DB"\ndatabase_name = "fbis"/);
 assert.match(c,/binding = "MARKET_HISTORY_DB"\ndatabase_name = "fbis-market-history"/);
});
