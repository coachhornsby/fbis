import test from "node:test";
import assert from "node:assert/strict";
import {matchKalshiTennisResearch} from "../functions/lib/tennisKalshiResearch.js";
const now=new Date("2026-10-20T14:50:00.000Z");
const fixture={tour:"atp",start:"2026-10-20T14:00:00.000Z",
 away_name:"Timofey Skatov",home_name:"Fabian Marozsan"};
const base={sport:"atp",status:"active",eventTicker:"KXATPMATCH-26OCT20SKAMAR",
 ticker:"KXATPMATCH-26OCT20SKAMAR-SKA",title:"Timofey Skatov vs Fabian Marozsan",
 rulesPrimary:"If Timofey Skatov wins against Fabian Marozsan after first ball",
 yesLabel:"Timofey Skatov",yesAskDollars:0.51,
 fetchedAt:"2026-10-20T14:40:00.000Z",
 closeAt:"2026-10-20T16:00:00.000Z"};
test("exact full player names yield Kalshi research only",()=>{
 const rows=matchKalshiTennisResearch(fixture,[base],now);
 assert.equal(rows.length,1);
 assert.equal(rows[0].canAuthorizeWager,false);
 assert.equal(rows[0].executionEligible,false);
 assert.equal(rows[0].quoteSourceTime,null);
 assert.equal(rows[0].yesAskDollars,.51);
});
test("wrong identity, future capture, missing start and ambiguous provider events fail shut",()=>{
 assert.equal(matchKalshiTennisResearch({...fixture,home_name:"Other Player"},[base],now).length,0);
 assert.equal(matchKalshiTennisResearch(fixture,[{...base,fetchedAt:"2026-10-20T15:00:00Z"}],now).length,0);
 assert.equal(matchKalshiTennisResearch(fixture,[{...base,closeAt:null,expectedExpirationAt:null}],now).length,0);
 assert.equal(matchKalshiTennisResearch(fixture,[base,{...base,ticker:"KXATPMATCH-26OCT20XXMAR-MAR",eventTicker:"KXATPMATCH-26OCT20XXMAR"}],now).length,0);
});
