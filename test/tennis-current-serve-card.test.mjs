import test from "node:test";
import assert from "node:assert/strict";
import {loadTennisServeResearchIndex,selectTennisServeResearchPlayer} from "../functions/lib/tennisServeResearchCard.js";
const now=Date.parse("2026-10-20T19:30:00Z");
const make=(lastDate="2026-10-19")=>({meta:{built:"2026-10-20T18:31:00Z"},
 canonicalRefresh:{scope:"current",bet:false},players:{
  S0TM:{name:"Toby Samuel",lastDate,surfaces:{Hard:{n:27,servePtsWonPct:.64,retPtsWonPct:.42,winPct:.56}},recent:{last10Played:10,last10Wins:6}},
  BU13:{name:"Zizou Bergs",lastDate:"2026-10-21",surfaces:{Hard:{n:30,servePtsWonPct:.67,retPtsWonPct:.38}},recent:{last10Played:10,last10Wins:6}},
  T09X:{name:"Clement Tabur",lastDate:"2026-10-19",surfaces:{Hard:{n:3,servePtsWonPct:.62,retPtsWonPct:.37}}}
 }});
test("current archive gives date-correct hard-court research without wagering capability",async()=>{
 let reads=0;
 const archive={get:async()=>{reads++;return {json:async()=>make()}}};
 const index=await loadTennisServeResearchIndex(archive,{now});
 assert.equal(reads,1);
 const p=selectTennisServeResearchPlayer(index,"Toby Samuel","2026-10-20T14:10:00Z");
 assert.equal(p.sourcePlayerId,"S0TM");
 assert.equal(p.hardServePointsWon,.64);
 assert.equal(p.hardReturnPointsWon,.42);
 assert.deepEqual(p.last10,{wins:6,played:10});
 assert.equal(p.canAuthorizeWager,false);
 assert.equal(p.canChangeProjection,false);
 const cached=await loadTennisServeResearchIndex(archive,{now:now+12000});
 assert.equal(cached,index);
 assert.equal(reads,1);
});
test("future results, same-day lookahead, thin records and ambiguous player names fail closed",async()=>{
 const ix=await loadTennisServeResearchIndex({get:async()=>({json:async()=>make()})},{now:now+121000});
 assert.equal(selectTennisServeResearchPlayer(ix,"Zizou Bergs","2026-10-20T14:10:00Z"),null);
 assert.equal(selectTennisServeResearchPlayer(ix,"Toby Samuel","2026-10-19T23:00:00Z"),null);
 assert.equal(selectTennisServeResearchPlayer(ix,"Clement Tabur","2026-10-20T14:10:00Z"),null);
 assert.equal(selectTennisServeResearchPlayer(ix,"Unknown Athlete","2026-10-20T14:10:00Z"),null);
});
test("research library rejects betting-enabled or future-built source receipt",async()=>{
 const value=await loadTennisServeResearchIndex({get:async()=>({json:async()=>({...make(),canonicalRefresh:{bet:true}})})},{now:now+600000});
 assert.equal(value,null);
});
