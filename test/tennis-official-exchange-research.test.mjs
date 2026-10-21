import test from "node:test";
import assert from "node:assert/strict";
import {attachOfficialTennisExchangeResearch} from "../functions/lib/tennisOfficialExchangeResearch.js";

const now=new Date("2026-10-21T18:00:00Z");
test("official projected match displays individually matched Kalshi sides without changing model",()=>{
 const eventTicker="KXWTAMATCH-26OCT21KRUTAR";
 const base={sport:"wta",eventTicker,status:"active",expectedExpirationAt:"2026-10-21T20:00:00Z",
  fetchedAt:"2026-10-21T17:55:00Z",
  rulesPrimary:"This professional tennis match is Ashlyn Krueger against Lanlana Tararudee.",
  yesAskDollars:0.55,yesBidDollars:0.52};
 const kalshi={status:"RESEARCH_SNAPSHOT",wta:[
  {...base,ticker:eventTicker+"-KRU",yesLabel:"Ashlyn Krueger"},
  {...base,ticker:eventTicker+"-TAR",yesLabel:"Lanlana Tararudee",yesAskDollars:0.47}]};
 const game={sport:"tennis",tour:"WTA",start:"2026-10-21T20:00:00Z",
  home:{name:"Lanlana Tararudee"},away:{name:"Ashlyn Krueger"},
  tennisProjection:{eventIntegrity:{valid:true},player1WinProb:0.56,player2WinProb:0.44}};
 const out=attachOfficialTennisExchangeResearch([game],{kalshi,now});
 assert.equal(out[0].tennisProjection.kalshiResearchOffers.length,2);
 assert.equal(out[0].tennisProjection.kalshiResearchOffers[0].yesLabel,"Ashlyn Krueger");
 assert.equal(out[0].tennisProjection.kalshiResearchOffers[1].yesAskDollars,0.47);
 assert.equal(out[0].tennisProjection.player1WinProb,0.56);
 assert.equal(out[0].tennisProjection.kalshiResearchOffers[0].canAuthorizeWager,false);
});
test("missing exchange snapshots do not suppress an official FBIS projection",()=>{
 const game={sport:"tennis",tour:"WTA",start:"2026-10-21T20:00:00Z",
  home:{name:"Lanlana Tararudee"},away:{name:"Ashlyn Krueger"},
  tennisProjection:{eventIntegrity:{valid:true},player1WinProb:0.56}};
 attachOfficialTennisExchangeResearch([game],{now});
 assert.deepEqual(game.tennisProjection.kalshiResearchOffers,[]);
 assert.equal(game.tennisProjection.kalshiResearchStatus,"NO_FRESH_SNAPSHOT");
 assert.equal(game.tennisProjection.player1WinProb,0.56);
});
test("independent ESPN fixture exchange data is not replaced by official enrichment",()=>{
 const existing={researchFixture:{verified:true},kalshiResearchOffers:[{ticker:"research"}]};
 const game={sport:"tennis",tour:"WTA",tennisProjection:existing};
 attachOfficialTennisExchangeResearch([game],{now});
 assert.equal(game.tennisProjection,existing);
});
