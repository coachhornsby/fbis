import test from "node:test";
import assert from "node:assert/strict";
import {matchNbaKalshiResearch} from "../functions/lib/nbaKalshiResearchMatch.js";
const now=new Date("2026-10-26T18:04:00Z");
const game={id:"4019001",sport:"nba",start:"2026-10-26T23:00:00Z",
 home:{fullName:"Boston Celtics"},away:{fullName:"New York Knicks"}};
const m={ticker:"KXNBAGAME-26OCT26NYKBOS-BOS",eventTicker:"KXNBAGAME-26OCT26NYKBOS",
 title:"New York Knicks at Boston Celtics",yesLabel:"Boston Celtics",
 occurrenceAt:"2026-10-26T23:00:00Z",fetchedAt:"2026-10-26T18:00:00Z",
 yesAskDollars:.58};
const snapshot={ok:true,records:[m],sport:"nba",seriesTicker:"KXNBAGAME",paginationComplete:true};
test("exact-team/start matching makes clickable research quote but never authorizes",()=>{
 const r=matchNbaKalshiResearch([game],snapshot,{now});
 const q=r.byGame.get(game.id)?.[0];
 assert.equal(q?.source,"Kalshi");assert.equal(q?.side,"home");assert.equal(q?.contractPrice,.58);
 assert.equal(q?.canAuthorizeWager,false);assert.equal(q?.executionEligible,false);
});
test("wrong tipoff or only one named team must never match",()=>{
 const t=matchNbaKalshiResearch([{...game,start:"2026-10-27T03:00:00Z"}],snapshot,{now});
 assert.equal(t.stats.matched,0);
 const u=matchNbaKalshiResearch([game],{...snapshot,records:[{...m,title:"Boston Celtics to win"}]},{now});
 assert.equal(u.stats.matched,0);
});
test("missing complete source snapshot and ambiguous team identity fail closed",()=>{
 assert.equal(matchNbaKalshiResearch([game],{...snapshot,paginationComplete:false},{now}).status,"SNAPSHOT_UNAVAILABLE");
 const d=matchNbaKalshiResearch([game,{...game,id:"other"}],snapshot,{now});
 assert.equal(d.stats.matched,0);
});
