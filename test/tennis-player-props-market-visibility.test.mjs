import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {tennisExchangeResearchCards,tennisBoardPlayerPhoto} from "../src/lib/tennisPropMarketResearch.js";

const fixture = {
  id:"tennis-watson-samsonova",sport:"tennis",tour:"wta",
  start:"2026-10-24T01:30:00.000Z",
  away:{name:"Heather Watson"},home:{name:"Liudmila Samsonova"},
  tennisProjection:{
    eventIntegrity:{valid:true},
    player1WinProb:.657,player2WinProb:.343,
    tournament:"Toray Pan Pacific Open",
    kalshiResearchOffers:[
      {yesLabel:"Heather Watson",yesAskDollars:.14},
      {yesLabel:"Liudmila Samsonova",yesAskDollars:.87}
    ],
    polymarketGlobalOffers:[
      {marketId:"match",question:"Pan Pacific Open: Liudmila Samsonova vs Heather Watson",
        outcomes:["Liudmila Samsonova","Heather Watson"],indicativePrices:[.87,.13],
        researchClob:{sides:[{bestAsk:{price:.88}},{bestAsk:{price:.14}}]}},
      {marketId:"set1",question:"Set 1 Winner: Liudmila Samsonova vs Heather Watson",
        outcomes:["Liudmila Samsonova","Heather Watson"],indicativePrices:[.81,.19]},
      {marketId:"spread",question:"Game Spread: Liudmila Samsonova (-5.5) vs Heather Watson (+5.5)",
        outcomes:["Liudmila Samsonova","Heather Watson"],indicativePrices:[.55,.45]},
    ]
  }
};
test("Tennis match markets appear with provider-native prices and aligned athlete order",()=>{
  const cards=tennisExchangeResearchCards([fixture]);
  assert.equal(cards.length,1);
  const row=cards[0];
  assert.equal(row.marketRole,"TENNIS_MATCH_MARKET_RESEARCH");
  assert.equal(row.playerStatProjection,false);
  assert.equal(row.canQualify,false);
  assert.equal(row.canAuthorizeWager,false);
  assert.deepEqual(row.matchWinProbability,[.343,.657]);
  assert.deepEqual(row.kalshi.map(o=>o.name),["Heather Watson","Liudmila Samsonova"]);
  assert.deepEqual(row.polymarket.sides.map(o=>o.name),["Heather Watson","Liudmila Samsonova"]);
  assert.deepEqual(row.polymarket.sides.map(o=>o.ask),[.14,.88]);
  assert.deepEqual(row.derivative.map(o=>o.id),["set1","spread"]);
  assert.deepEqual(row.derivative[0].indicative,[.81,.19]);
});
test("Match research does not use unrelated sports, unresolved fixture identities or unverified source markets",()=>{
  const mismatched={...fixture,sport:"nba"};
  const unresolved={...fixture,tennisProjection:{...fixture.tennisProjection,eventIntegrity:{valid:false}}};
  const noQuotes={...fixture,tennisProjection:{eventIntegrity:{valid:true}}};
  assert.equal(tennisExchangeResearchCards([mismatched,unresolved,noQuotes]).length,0);
});
test("Research fixtures with verified matches can display exchange markets without calling them stat props",()=>{
  const alternate={...fixture,id:"research-watson",tennisProjection:{
    ...fixture.tennisProjection,eventIntegrity:{valid:false},
    researchFixture:{verified:true,fixtureId:"research-watson"},player1WinProb:null,player2WinProb:null
  }};
  const [card]=tennisExchangeResearchCards([alternate]);
  assert.equal(card.matchWinProbability,null);
  assert.equal(card.playerStatProjection,false);
});
test("Player Props page is fed tennis Board data and preserves stat-card restriction",()=>{
  const panel=readFileSync(new URL("../src/features/playerProps/ExchangePlayerPropsPanel.jsx",import.meta.url),"utf8");
  const view=readFileSync(new URL("../src/features/playerProps/TennisExchangeResearch.jsx",import.meta.url),"utf8");
  const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
  assert.match(panel,/sport==="tennis" \? <TennisExchangeResearch/);
  assert.match(panel,/selectProjectedPropCards\(statCards/);
  assert.match(view,/\/api\/today\?/);
  assert.match(view,/match-level research markets, not individual player-stat props/);
  assert.match(view,/o\.ask!=null\?price\(o\.ask\)/);
  assert.match(app,/normalizedRoute === "player-props" && explicitSport && SPORTS\[explicitSport\]/);
  assert.match(app,/route === "player-props"\s*\?\s*\(SPORTS\[sportFilter\] \? sportFilter : "all"\)/);
});

test("Tennis market cards reuse two athlete portraits only from identity-verified Board sources",()=>{
 const approvedId="tennis:wta:326384";
 const approvedUrl="/api/tennis-portrait?id="+encodeURIComponent(approvedId);
 const withPhotos={...fixture,
   away:{name:"Heather Watson",fbisPlayerId:approvedId,headshotUrl:approvedUrl,
     imageSource:"RIGHTS_VERIFIED_TENNIS_PORTRAIT",
     portraitCredit:"Commons verified",portraitSourceUrl:"https://commons.wikimedia.org/wiki/File:Example.jpg"},
   home:{name:"Liudmila Samsonova",fbisPlayerId:"tennis:wta:123",
     headshotUrl:"https://static.prizepicks.com/images/manual/Athlete.png",imageSource:"PRIZEPICKS_FEED"},
 };
 const [card]=tennisExchangeResearchCards([withPhotos]);
 assert.equal(card.athletes[0].photo.url,approvedUrl);
 assert.equal(card.athletes[0].photo.credit,"Commons verified");
 assert.equal(card.athletes[1].photo.url,"https://static.prizepicks.com/images/manual/Athlete.png");
 assert.deepEqual(card.athletes.map(a=>a.name),["Heather Watson","Liudmila Samsonova"]);
 assert.deepEqual(card.kalshi.map(o=>o.name),["Heather Watson","Liudmila Samsonova"]);
});
test("No unapproved ATP/WTA photos, logos, arbitrary URLs or wrong athlete's portrait",()=>{
 const id="tennis:wta:326384";
 assert.equal(tennisBoardPlayerPhoto({fbisPlayerId:id,headshotUrl:"https://www.wtatennis.com/players/abc.jpg",imageSource:"WTA_OFFICIAL"}),null);
 assert.equal(tennisBoardPlayerPhoto({fbisPlayerId:id,headshotUrl:"https://img0.aiscore.com/v2/team/abc.png",imageSource:"PRIZEPICKS_FEED"}),null);
 assert.equal(tennisBoardPlayerPhoto({fbisPlayerId:id,headshotUrl:"https://example.com/logos/player.png",imageSource:"PRIZEPICKS_FEED"}),null);
 assert.equal(tennisBoardPlayerPhoto({fbisPlayerId:id,headshotUrl:"/api/tennis-portrait?id=tennis%3Awta%3AOTHER",imageSource:"RIGHTS_VERIFIED_TENNIS_PORTRAIT"}),null);
 assert.equal(tennisBoardPlayerPhoto({fbisPlayerId:id,headshotUrl:"/api/tennis-portrait?id=%xx",imageSource:"RIGHTS_VERIFIED_TENNIS_PORTRAIT"}),null);
 assert.equal(tennisBoardPlayerPhoto({headshotUrl:"https://static.prizepicks.com/images/manual/valid.png"}),null);
 const [noPhoto]=tennisExchangeResearchCards([fixture]);
 assert.equal(noPhoto.athletes[0].photo,null);
 assert.equal(noPhoto.athletes[1].photo,null);
});
test("Tennis exchange UI renders two resilient face slots and photo attribution",()=>{
 const view=readFileSync(new URL("../src/features/playerProps/TennisExchangeResearch.jsx",import.meta.url),"utf8");
 assert.match(view,/function TennisAthletePhoto/);
 assert.match(view,/card\.athletes\.map/);
 assert.match(view,/onError=\{\(\)=>setFailed\(true\)\}/);
 assert.match(view,/photo\.creditUrl/);
});
