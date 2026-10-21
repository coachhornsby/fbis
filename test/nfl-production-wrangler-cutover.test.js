import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REQUIRED_PAGES_D1_BINDINGS } from "../functions/lib/topologyBindingGate.js";
const file=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
const base=file.split("[env.production.vars]")[0];
const production=file.split("[env.production.vars]")[1]||"";
const prodVars=production.split("[[env.production.d1_databases]]")[0];
test("base/preview remain shadow while only NFL is authoritative in production",()=>{
 assert.match(base,/SPORT_DB_MODE_NFL\s*=\s*"shadow"/);
 assert.match(prodVars,/SPORT_DB_MODE_NFL\s*=\s*"sport"/);
 assert.match(prodVars,/SPORT_DB_STRICT_NFL\s*=\s*"true"/);
 assert.match(prodVars,/SPORT_CUTOVER_RECEIPT_NFL\s*=\s*"nfl-20261021-production-v1"/);
 for(const sport of ["CFB","NHL","NBA","MLB","CBB","WNBA","SOCCER","TENNIS","NPB","KBO"]){
  assert.match(prodVars,new RegExp("SPORT_DB_MODE_"+sport+"\\s*=\\s*\"shadow\""));
 }
});
test("production binding overrides preserve every required D1 and archive binding",()=>{
 const matches=[...production.matchAll(/\[\[env\.production\.d1_databases\]\]\s*binding\s*=\s*"([^"]+)"\s*database_name\s*=\s*"[^"]+"\s*database_id\s*=\s*"([^"]+)"/g)];
 const ids=new Map(matches.map(([,binding,id])=>[binding,id]));
 for(const required of REQUIRED_PAGES_D1_BINDINGS){
  assert.equal(ids.get(required.binding),required.databaseId,"missing "+required.binding);
 }
 assert.equal(ids.size,REQUIRED_PAGES_D1_BINDINGS.length);
 assert.match(production,/\[\[env\.production\.r2_buckets\]\]\s*binding\s*=\s*"ARCHIVE"/);
});
