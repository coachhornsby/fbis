import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {loadKalshiSeriesCatalog,onRequestGet,onRequestPost}
 from "../functions/api/kalshi-series-catalog.js";

const SOURCE="kalshi/public-shadow/v1/series-catalog.json";
function archive(payload){
 return {async get(k){assert.equal(k,SOURCE);return payload?{json:async()=>payload}:null;}};
}
const records=[
 {ticker:"KXNFLGAME",title:"NFL Football game winners",category:"Sports",tags:["Football","NFL"]},
 {ticker:"KXNBAGAME",title:"NBA basketball game winners",category:"Sports",tags:["Basketball","NBA"]},
 {ticker:"KXSOCCERML",title:"Soccer match result",category:"Sports",tags:["Soccer"]},
 {ticker:"KXATP",title:"Men's tennis match winner",category:"Sports",tags:["Tennis","ATP"]},
];
function fixture(){return {ok:true,reportedSeries:4,storedSeries:4,truncated:false,
 observedAt:"2026-10-20T13:15:24.630Z",records};}
test("searches existing R2 series only and never requests Kalshi",async()=>{
 const q=await loadKalshiSeriesCatalog({ARCHIVE:archive(fixture())},{query:"NFL"});
 assert.equal(q.ok,true);
 assert.equal(q.totalMatches,1);
 assert.equal(q.records[0].ticker,"KXNFLGAME");
 assert.equal(q.records[0].canQualify,false);
 assert.equal(q.canChangeCORE,false);
 assert.equal(q.canPublishMarketOdds,false);
 assert.equal(q.canAuthorizeWager,false);
 const tennis=await loadKalshiSeriesCatalog({ARCHIVE:archive(fixture())},{query:"Tennis"});
 assert.equal(tennis.records.length,1);
 assert.equal(tennis.records[0].ticker,"KXATP");
 const response=await onRequestGet({
  request:new Request("https://fbis.test/api/kalshi-series-catalog?q=soccer"),
  env:{ARCHIVE:archive(fixture())},
 });
 assert.equal(response.status,200);
 assert.equal((await response.json()).records[0].ticker,"KXSOCCERML");
 assert.equal((await onRequestPost()).status,405);
});
test("bounded pagination returns next offset and never all 4,014 series in one response",async()=>{
 const big={...fixture(),records:Array.from({length:4014},(_,i)=>({
  ticker:"KXSPORT"+String(i).padStart(5,"0"),title:"Sport "+i,
 })),reportedSeries:4014,storedSeries:4014};
 const data=await loadKalshiSeriesCatalog({ARCHIVE:archive(big)},{limit:999,offset:70});
 assert.equal(data.records.length,50);
 assert.equal(data.totalMatches,4014);
 assert.equal(data.nextOffset,120);
 assert.equal(data.reportedSeries,4014);
 assert.equal(data.storedSeries,4014);
 assert.equal(data.canQualify,false);
 const last=await loadKalshiSeriesCatalog({ARCHIVE:archive(big)},{limit:40,offset:4000});
 assert.equal(last.records.length,14);
 assert.equal(last.nextOffset,null);
});
test("absent or invalid catalog fails closed with no invented market rows",async()=>{
 assert.equal((await loadKalshiSeriesCatalog({ARCHIVE:archive(null)})).code,
   "KALSHI_SERIES_CATALOG_NOT_READY");
 assert.equal((await loadKalshiSeriesCatalog({ARCHIVE:archive({ok:true,records:"bad"})})).code,
   "KALSHI_SERIES_CATALOG_INVALID");
});
test("System explorer filters real catalog and cannot wager",()=>{
 const src=readFileSync(new URL("../src/features/dataHealth/KalshiSeriesExplorer.jsx",import.meta.url),"utf8");
 const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
 assert.match(app,/KalshiSeriesExplorer/);
 assert.match(src,/api\/kalshi-series-catalog/);
 assert.match(src,/RESEARCH ONLY/);
 assert.doesNotMatch(src,/placeOrder|authorizeWager|setProjection|setBet/);
});
