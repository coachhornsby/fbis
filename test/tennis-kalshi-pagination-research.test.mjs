import test from "node:test";
import assert from "node:assert/strict";
import {loadKalshiTennisResearch} from "../functions/lib/tennisKalshiResearch.js";

const now=new Date("2026-10-21T18:00:00Z");
const prefix="kalshi/public-shadow/v1/";
const row={sport:"wta",ticker:"KXWTAMATCH-26OCT21KRUTAR-KRU",
 eventTicker:"KXWTAMATCH-26OCT21KRUTAR",status:"active",
 yesLabel:"Ashlyn Krueger",fetchedAt:"2026-10-21T17:55:00Z"};
function archive(progress){
 return {get:async key=>key===prefix+"sports/wta-progress.json"
   ?{json:async()=>progress}:null};
}
test("fresh partial signed Kalshi pagination is labeled incomplete and never authorizes bets",async()=>{
 const progress={version:1,sport:"wta",startedAt:"2026-10-21T17:30:00Z",
  pagesFetched:1,cursor:"next-cursor",records:[row]};
 const result=await loadKalshiTennisResearch({ARCHIVE:archive(progress)},now);
 assert.equal(result.wta.length,1);
 assert.equal(result.wtaStatus,"PARTIAL_PAGINATING_RESEARCH_ONLY");
 assert.equal(result.status,"PARTIAL_RESEARCH_SNAPSHOT");
 assert.equal(result.wta[0].canAuthorizeWager,false);
 assert.equal(result.wta[0].executionEligible,false);
 assert.equal(result.wta[0].fetchedAt,row.fetchedAt);
});
test("stale progress, stale quotes, wrong sport, and completed cursors cannot populate research",async()=>{
 const base={version:1,sport:"wta",startedAt:"2026-10-21T17:30:00Z",pagesFetched:1,cursor:"next",records:[row]};
 for(const changed of [
  {...base,startedAt:"2026-10-20T00:00:00Z"},
  {...base,records:[{...row,fetchedAt:"2026-10-21T12:00:00Z"}]},
  {...base,sport:"atp"},
  {...base,cursor:""}]){
  const result=await loadKalshiTennisResearch({ARCHIVE:archive(changed)},now);
  assert.deepEqual(result.wta,[]);
 }
});
