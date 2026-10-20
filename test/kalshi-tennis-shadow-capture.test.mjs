import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {KALSHI_SHADOW_SERIES,getKalshiShadowMarketsPage} from "../functions/lib/kalshiMarketShadow.js";
test("ATP and WTA use independently discovered real match-winner series",async()=>{
 assert.equal(KALSHI_SHADOW_SERIES.atp,"KXATPMATCH");
 assert.equal(KALSHI_SHADOW_SERIES.wta,"KXWTAMATCH");
 for(const sport of ["atp","wta"]){
  let called=false;
  const r=await getKalshiShadowMarketsPage(sport,{fetchImpl:async url=>{
   called=true;assert.match(url,new RegExp("series_ticker="+KALSHI_SHADOW_SERIES[sport]));
   return {ok:true,status:200,json:async()=>({markets:[],cursor:""})};
  }});
  assert.ok(called);
  assert.equal(r.ok,true);
  assert.equal(r.records.length,0);
  assert.equal(r.governance.canAuthorizeWager,false);
 }
});
test("Tennis signed collector is restricted to read-only match shadow",()=>{
 const signed=readFileSync(new URL("../functions/lib/kalshiSignedCollector.js",import.meta.url),"utf8");
 const internal=readFileSync(new URL("../functions/api/kalshi-collector-internal.js",import.meta.url),"utf8");
 const worker=readFileSync(new URL("../services/kalshi-public-collector/index.js",import.meta.url),"utf8");
 assert.match(signed,/\["nfl","cfb","atp","wta"\]/);
 assert.match(internal,/\["nfl","cfb","atp","wta"\]/);
 assert.match(worker,/TENNIS_RESEARCH=\["atp","wta"\]/);
 assert.match(worker,/collectKalshiTennisShadowOnce/);
});
