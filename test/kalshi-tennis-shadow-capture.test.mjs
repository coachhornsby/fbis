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
 assert.match(signed,/atp_challenger/);
 assert.match(signed,/itf_women_doubles/);
 assert.match(internal,/atp_challenger/);
 assert.match(internal,/itf_women_doubles/);
 assert.match(worker,/TENNIS_RESEARCH=\["atp","wta","atp_challenger"/);
 assert.match(worker,/itf_women_doubles/);
 assert.match(worker,/collectKalshiTennisShadowOnce/);
});

test("public signed shadow identifies all match families advertised on Kalshi Tennis",async()=>{
 const expected={atp:"KXATPMATCH",wta:"KXWTAMATCH",
  atp_challenger:"KXATPCHALLENGERMATCH",itf_men:"KXITFMATCH",
  itf_women:"KXITFWMATCH",atp_doubles:"KXATPDOUBLES",
  wta_doubles:"KXWTADOUBLES",itf_doubles:"KXITFDOUBLES",
  itf_women_doubles:"KXITFWDOUBLES"};
 for(const [sport,series] of Object.entries(expected)){
  assert.equal(KALSHI_SHADOW_SERIES[sport],series);
  const result=await getKalshiShadowMarketsPage(sport,{fetchImpl:async url=>{
   assert.equal(new URL(url).searchParams.get("series_ticker"),series);
   return Response.json({markets:[],cursor:""});
  }});
  assert.equal(result.ok,true);
  assert.equal(result.governance.canAuthorizeWager,false);
 }
});
