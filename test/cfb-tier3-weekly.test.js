import test from "node:test";
import assert from "node:assert/strict";
import {parseCfbTier3WeeklyCsv,saveCfbTier3WeeklySnapshot} from "../functions/lib/cfbTier3Weekly.js";
import {onRequestPost,onRequestGet} from "../functions/api/college-tier3.js";
const cols=["id","start_date","season","season_type","week","neutral_site","home_team",
 "home_conference","away_team","away_conference","spread",...Array.from({length:12},(_,i)=>"feature_"+i)];
const row=(id="401111111",week="7")=>[id,"2026-10-17 19:30:00","2026","regular",week,"False",
 "Georgia","SEC","Auburn","SEC","-19.5",...Array.from({length:12},(_,i)=>String(i/10))].join(",");
const csv=(items=[row()])=>cols.join(",")+"\n"+items.join("\n")+"\n";
test("Tier 3 validates weekly CSV, archives all metrics but isolates opening spread",async()=>{
 const v=await parseCfbTier3WeeklyCsv(csv(),{receivedAt:"2026-10-15T07:00:00Z",filename:"training_data_2026_week07.csv"});
 assert.equal(v.rowCount,1);assert.equal(v.featureCount,12);
 assert.equal(v.games[0].openingSpread,-19.5);
 assert.equal(v.games[0].features.feature_0,0);
 assert.ok(!Object.hasOwn(v.games[0].features,"spread"));
 assert.equal(v.providerPublishedAt,null);
 assert.equal(v.games[0].pointInTimeStatus,"source_feature_cutoff_unverified");
 assert.equal(v.canAuthorizeWager,false);assert.equal(v.canInfluenceProjection,false);
 assert.equal(v.games[0].authority,"research_only");
});
test("Tier 3 snapshot id stable and duplicates or mixed weeks rejected",async()=>{
 const a=await parseCfbTier3WeeklyCsv(csv());
 const b=await parseCfbTier3WeeklyCsv(csv());
 assert.equal(a.sourceSha256,b.sourceSha256);assert.equal(a.snapshotId,b.snapshotId);
 await assert.rejects(parseCfbTier3WeeklyCsv(csv([row(),row()])),/DUPLICATE/);
 await assert.rejects(parseCfbTier3WeeklyCsv(csv([row(),row("401111112","8")])),/MIXED_SNAPSHOT/);
});
test("Tier 3 blocks outcome targets and nonnumeric features",async()=>{
 const badHeader=csv().replace("feature_0","winner");
 await assert.rejects(parseCfbTier3WeeklyCsv(badHeader),/TARGET_LEAKAGE/);
 await assert.rejects(parseCfbTier3WeeklyCsv(csv().replace(",0,0.1,",",bad,0.1,")),/NON_NUMERIC_FEATURE/);
});
test("private R2 + D1 write without any network HTTP or model promotion",async()=>{
 const history=[];const saved=[];
 const DB={prepare(sql){return{bind(...params){return{sql,params}}};},
   async batch(stmts){history.push(...stmts);return [{meta:{changes:1}}]}};
 const ARCHIVE={async put(key,raw){saved.push({key,raw})}};
 const input=csv();const snapshot=await parseCfbTier3WeeklyCsv(input);
 const res=await saveCfbTier3WeeklySnapshot({DB,ARCHIVE},snapshot,input);
 assert.equal(res.ok,true);assert.equal(res.networkCalls,0);
 assert.equal(history.length,2);assert.equal(saved.length,1);
 assert.equal(saved[0].raw,input);assert.match(saved[0].key,/licensed\/cfbd\/tier3/);
 assert.equal(res.canAuthorizeWager,false);
});
test("operator route denies missing or incorrect harvest token before parsing",async()=>{
 for(const headers of [{},{'x-harvest-secret':'bad'}]){
  const req=new Request("https://fbis.example/api/college-tier3",{method:"POST",
   headers:{"content-type":"text/csv",...headers},body:csv()});
  const res=await onRequestPost({request:req,env:{HARVEST_SECRET:"correct"}});
  assert.equal(res.status,401);
 }
 const list=await onRequestGet({request:new Request("https://fbis.example/api/college-tier3"),
  env:{HARVEST_SECRET:"correct"}});
 assert.equal(list.status,401);
});
