import test from "node:test";
import assert from "node:assert/strict";
import {matchKalshiTennisResearch} from "../functions/lib/tennisKalshiResearch.js";
const now=new Date("2026-10-20T17:00:00Z");
const fixture={tour:"atp",away_name:"Toby Samuel",home_name:"Zizou Bergs",start:"2026-10-20T14:10:00Z"};
const row=(name)=>({
 sport:"atp",status:"active",
 ticker:"KXATPMATCH-26OCT18SAMBER-"+(name==="Toby Samuel"?"SAM":"BER"),
 eventTicker:"KXATPMATCH-26OCT18SAMBER",
 title:name+" wins",yesLabel:name,
 rulesPrimary:`If ${name} wins the Samuel vs Bergs professional tennis match in the 2026 ATP Brussels Round Of 32 after a ball has been played, then the market resolves to Yes.`,
 expectedExpirationAt:"2026-10-18T13:30:00Z",
 closeAt:"2026-11-01T10:30:00Z",
 fetchedAt:"2026-10-20T16:15:24Z",yesAskDollars:name==="Toby Samuel"?.35:.66
});
test("Kalshi research pair matches two explicit winners despite surnames-only pair and remote administrative close date",()=>{
 const offers=matchKalshiTennisResearch(fixture,[row("Toby Samuel"),row("Zizou Bergs")],now);
 assert.equal(offers.length,2);
 assert.deepEqual(offers.map(x=>x.yesLabel),["Toby Samuel","Zizou Bergs"]);
 assert.ok(offers.every(x=>x.scheduleStatus==="PROVIDER_START_DIFFERS"));
 assert.ok(offers.every(x=>x.canQualify===false&&x.canAuthorizeWager===false));
});
test("single winner contract, renamed opponent, ambiguous event, stale captures and wrong tour fail closed",()=>{
 const a=row("Toby Samuel"),b=row("Zizou Bergs");
 assert.deepEqual(matchKalshiTennisResearch(fixture,[a],now),[]);
 assert.deepEqual(matchKalshiTennisResearch(fixture,[a,{...b,rulesPrimary:"Bergs vs Someone professional tennis match"}],now),[]);
 assert.deepEqual(matchKalshiTennisResearch(fixture,[a,b,{...a,eventTicker:"second",ticker:"KXATPMATCH-SECOND-SAM"},{...b,eventTicker:"second",ticker:"KXATPMATCH-SECOND-BER"}],now),[]);
 assert.deepEqual(matchKalshiTennisResearch(fixture,[{...a,fetchedAt:"2026-10-19T13:00:00Z"},b],now),[]);
 assert.deepEqual(matchKalshiTennisResearch({...fixture,tour:"wta"},[a,b],now),[]);
});
