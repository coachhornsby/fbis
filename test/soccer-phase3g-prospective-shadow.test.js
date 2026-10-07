import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadSoccerMatchHistory } from "../functions/lib/store.js";
import {
  buildSoccerProspectiveShadowRecords,
  persistSoccerProspectiveShadow,
  gradeSoccerShadowProbability,
  gradeSoccerShadowValue,
  simulatedUnitResult,
} from "../functions/lib/soccerProspectiveShadow.js";

function game(league="esp.1"){
  const v2={
    ok:true,pHomeWin:.52,pDraw:.27,pAwayWin:.21,
    home:1.55,away:1.05,total:2.60,
    pBttsYes:.51,pBttsNo:.49,
    totals:{"2.5":{over:.53,under:.47}},
    homeAsian:{"-0.5":{win:.52,push:0,loss:.48}},
    provenance:{marketUsed:false},
  };
  const v31={
    ok:true,pHomeWin:.55,pDraw:.25,pAwayWin:.20,
    home:1.62,away:1.00,total:2.62,
    pBttsYes:.49,pBttsNo:.51,
    totals:{"2.5":{over:.55,under:.45}},
    homeAsian:{"-0.5":{win:.55,push:0,loss:.45}},
    provenance:{marketUsed:false,persistentStateUsed:false},
  };
  return{
    id:"match-1",soccerLeague:league,start:"2026-10-07T20:00:00Z",
    status:{completed:false,live:false},
    soccerFbisV2:v2,soccerFbisV3:v31,
    odds:{pinTotal:2.5,pinSpread:-0.5},
    pin:{
      total:{complete:true,priceA:-105,priceB:-115,noVigA:.49,noVigB:.51},
      spread:{complete:true,priceA:-110,priceB:-110,noVigA:.5,noVigB:.5},
    },
  };
}
function slate(){
  return{parlay:{observedAt:"2026-10-06T13:20:00Z"}};
}

test("Phase 3G collector emits only evidence-supported shadow routes",()=>{
  const r=buildSoccerProspectiveShadowRecords(game("esp.1"),slate(),{
    snapshotAt:"2026-10-06T13:25:12Z",collectorCodeSha:"collector-sha",
  });
  assert.equal(r.ok,true);
  assert.equal(r.rows.filter(x=>x.marketFamily==="1X2").length,3);
  assert.equal(r.rows.filter(x=>x.marketFamily==="GOALS").length,3);
  assert.equal(r.rows.filter(x=>x.marketFamily==="BTTS").length,2);
  assert.equal(r.rows.filter(x=>x.marketFamily==="TOTALS_O25").length,2);
  assert.equal(r.rows.filter(x=>x.marketFamily==="ASIAN_HANDICAP").length,2);
  assert.ok(r.rows.every(x=>x.selectedResearchModelId==="SOCCER-FBIS-v3.1"));
  assert.ok(r.rows.every(x=>x.provenance.modelMarketSeparation===true));
  assert.ok(r.rows.every(x=>x.provenance.persistentStateUsed===false));
  assert.ok(r.rows.every(x=>x.provenance.executionEvidence===false));
});

test("Phase 3G FAIL route stays absent while other EPL routes remain shadow eligible",()=>{
  const r=buildSoccerProspectiveShadowRecords(game("eng.1"),slate(),{
    snapshotAt:"2026-10-06T13:25:12Z",
  });
  assert.equal(r.ok,true);
  assert.equal(r.rows.some(x=>x.marketFamily==="1X2"),false);
  assert.equal(r.rows.some(x=>x.marketFamily==="GOALS"),true);
  assert.equal(r.rows.some(x=>x.marketFamily==="BTTS"),true);
});

test("Phase 3G UEL insufficient evidence creates no shadow rows",()=>{
  const r=buildSoccerProspectiveShadowRecords(game("uefa.europa"),slate(),{
    snapshotAt:"2026-10-06T13:25:12Z",
  });
  assert.equal(r.ok,true);
  assert.equal(r.rows.length,0);
});

test("Phase 3G records true freeze time while retry IDs are stable within five-minute bucket",()=>{
  const a=buildSoccerProspectiveShadowRecords(game(),slate(),{
    snapshotAt:"2026-10-06T13:25:12Z",
  });
  const b=buildSoccerProspectiveShadowRecords(game(),slate(),{
    snapshotAt:"2026-10-06T13:29:59Z",
  });
  assert.equal(a.rows[0].snapshotAt,"2026-10-06T13:25:12.000Z");
  assert.equal(b.rows[0].snapshotAt,"2026-10-06T13:29:59.000Z");
  assert.equal(a.rows[0].shadowId,b.rows[0].shadowId);
});


test("Phase 3H-R splits competition, v2, and v3.1 projection failures",()=>{
  const missingCompetition=game("");
  const a=buildSoccerProspectiveShadowRecords(missingCompetition,slate(),{snapshotAt:"2026-10-06T13:25:12Z"});
  assert.equal(a.ok,false);
  assert.equal(a.reason,"competition-unavailable");
  assert.equal(a.detail,"missing-league-mapping");

  const missingV2=game();
  missingV2.soccerFbisV2={ok:false,reason:"insufficient-canonical-history"};
  const b=buildSoccerProspectiveShadowRecords(missingV2,slate(),{snapshotAt:"2026-10-06T13:25:12Z"});
  assert.equal(b.ok,false);
  assert.equal(b.reason,"v2-projection-unavailable");
  assert.equal(b.detail,"insufficient-canonical-history");

  const missingV31=game();
  missingV31.soccerFbisV3={ok:false,reason:"insufficient-pitchapi-history"};
  const d=buildSoccerProspectiveShadowRecords(missingV31,slate(),{snapshotAt:"2026-10-06T13:25:12Z"});
  assert.equal(d.ok,false);
  assert.equal(d.reason,"v31-projection-unavailable");
  assert.equal(d.detail,"insufficient-pitchapi-history");
});

test("Phase 3G rejects post-kick and model governance contamination",()=>{
  const post=buildSoccerProspectiveShadowRecords(game(),slate(),{
    snapshotAt:"2026-10-07T20:00:01Z",
  });
  assert.equal(post.ok,false);
  assert.equal(post.reason,"post-kickoff-or-invalid-time");

  const contaminated=game();
  contaminated.soccerFbisV3={...contaminated.soccerFbisV3,provenance:{marketUsed:true,persistentStateUsed:false}};
  const bad=buildSoccerProspectiveShadowRecords(contaminated,slate(),{
    snapshotAt:"2026-10-06T13:25:12Z",
  });
  assert.equal(bad.ok,false);
  assert.equal(bad.reason,"model-governance-violation");
});

test("Phase 3G does not manufacture unavailable 1X2, BTTS, or stale derivative markets",()=>{
  const stale={parlay:{observedAt:"2026-10-06T12:00:00Z"}};
  const r=buildSoccerProspectiveShadowRecords(game(),stale,{
    snapshotAt:"2026-10-06T13:25:12Z",
  });
  const one=r.rows.filter(x=>x.marketFamily==="1X2");
  assert.ok(one.every(x=>x.marketNoVigProbability==null&&x.marketUnavailableReason==="COMPLETE_3WAY_1X2_MARKET_UNAVAILABLE"));
  const btts=r.rows.filter(x=>x.marketFamily==="BTTS");
  assert.ok(btts.every(x=>x.marketNoVigProbability==null&&x.marketUnavailableReason==="BTTS_MARKET_UNAVAILABLE"));
  const totals=r.rows.filter(x=>x.marketFamily==="TOTALS_O25");
  assert.ok(totals.every(x=>x.marketNoVigProbability==null&&x.marketUnavailableReason==="MARKET_STALE"));
});

test("Phase 3G persistence is INSERT OR IGNORE and governance is hard-coded off",async()=>{
  const built=buildSoccerProspectiveShadowRecords(game(),slate(),{
    snapshotAt:"2026-10-06T13:25:12Z",
  });
  const calls=[];
  const db={prepare(sql){return{bind(...args){calls.push({sql,args});return{run:async()=>({meta:{changes:1}})}}}}};
  const p=await persistSoccerProspectiveShadow(db,built.rows.slice(0,1));
  assert.equal(p.ok,true);
  assert.equal(p.written,1);
  assert.match(calls[0].sql,/INSERT OR IGNORE INTO soccer_prospective_shadow/);
  assert.deepEqual(calls[0].args.slice(-3),[1,0,0]);
});

test("Phase 3G grading helpers stay research/simulation primitives",()=>{
  const prob=gradeSoccerShadowProbability({v2Probability:.45,v31Probability:.6,outcome:1});
  assert.ok(prob.v31.brier<prob.v2.brier);
  assert.ok(prob.v31.logLoss<prob.v2.logLoss);
  const value=gradeSoccerShadowValue({v2ProjectionValue:2.4,v31ProjectionValue:2.7,actual:3});
  assert.ok(Math.abs(value.v2AbsError-.6)<1e-12);
  assert.ok(Math.abs(value.v31AbsError-.3)<1e-12);
  assert.equal(simulatedUnitResult({result:"WIN",americanPrice:-110}),100/110);
  assert.equal(simulatedUnitResult({result:"LOSS",americanPrice:+120}),-1);
  assert.equal(simulatedUnitResult({result:"PUSH",americanPrice:-110}),0);
});

test("Phase 3G has no recurring Soccer prospective-shadow scheduler",async()=>{
  const tree=await readFile(new URL("../package.json",import.meta.url),"utf8");
  assert.doesNotMatch(tree,/soccer-prospective-shadow\.yml/);
  const api=await readFile(new URL("../functions/api/soccer-prospective-shadow.js",import.meta.url),"utf8");
  assert.match(api,/parlayCacheOnly:true/);
  assert.match(api,/researchOnly:true/);
  assert.match(api,/canQualify:false/);
  assert.match(api,/canAuthorize:false/);
});


test("Phase 3H-R3 canonical history loader does not coerce null season to zero", async()=>{
  let sqlSeen="";
  let bindsSeen=[];
  const env={DB:{prepare(sql){
    sqlSeen=sql;
    return {bind(...binds){
      bindsSeen=binds;
      return {all:async()=>({results:[]})};
    }};
  }}};
  await loadSoccerMatchHistory(env,{
    league:"ger.1",
    season:null,
    startDate:"2024-04-23",
    beforeDate:"2026-10-09",
  });
  assert.equal(sqlSeen.includes("season = ?"),false);
  assert.deepEqual(bindsSeen,["ger.1","2024-04-23","2026-10-09"]);
});
