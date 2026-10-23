import test from "node:test";
import assert from "node:assert/strict";
import {bestValuePresentation,rankResearchMoneylines} from "../src/lib/bestValuePresentation.js";
const now=new Date("2026-10-20T13:00:00Z");
const basic={sport:"nhl",start:"2026-10-20T23:00:00Z",
 home:{abbr:"MTL",name:"Montreal Canadiens"},away:{abbr:"SJ",name:"San Jose Sharks"},
 canQualify:false,canAuthorizeWager:false,
 nhlProV2:{ok:true,independent:true,marketInformed:false,home:"MTL",away:"SJ",
  probability:{homeWinIncludingOt:.6552,awayWinIncludingOt:.3448}},
 pinnoddsResearch:{offers:[
 {source:"PinnOdds",marketFamily:"moneyline",period:"full_game",side:"home",sourceMarketId:"ml",
 americanOdds:-140,standardOrAlt:"main",capturedAt:"2026-10-20T12:55:00Z"},
 {source:"PinnOdds",marketFamily:"moneyline",period:"full_game",side:"away",sourceMarketId:"ml",
 americanOdds:130,standardOrAlt:"main",capturedAt:"2026-10-20T12:55:00Z"}]}};
test("positive unqualified research value appears without granting wagering authority",()=>{
 const v=bestValuePresentation(basic,{sport:"nhl",home:basic.home,away:basic.away,comparison:{sideDiff:.8},
 decision:{evAvailable:false}},{now});
 assert.equal(v.status,"research");
 assert.match(v.value,/MTL ML -140/);
 assert.match(v.detail,/EST. ROI \+12\.3%/);
 assert.match(v.secondary,/NOT EXECUTABLE/);
 assert.equal(v.research.qualified,false);
 assert.doesNotMatch(JSON.stringify(v),/0\.8 GOALS DIFFERENCE/);
});
test("negative moneyline research ROI is not converted to a recommendation",()=>{
 const g={...basic,pinnoddsResearch:{offers:basic.pinnoddsResearch.offers.map(q=>({...q,americanOdds:q.side==="home"?-205:+179}))}};
 const v=bestValuePresentation(g,{sport:"nhl",home:g.home,away:g.away},{now});
 assert.equal(v.status,"pass");
 assert.equal(v.value,"NO POSITIVE PRICED VALUE");
});
test("missing stale quotes cannot generate research expected returns",()=>{
 const g={...basic,pinnoddsResearch:{offers:basic.pinnoddsResearch.offers.map(q=>({...q,capturedAt:"2026-10-20T10:00:00Z"}))}};
 const v=bestValuePresentation(g,{sport:"nhl",home:g.home,away:g.away},{now});
 assert.equal(v.status,"unpriced");
 assert.doesNotMatch(JSON.stringify(v),/EST. ROI/);
});
test("model, event identity, and paired source clock mismatches all fail closed",()=>{
 const mismatch={...basic,nhlProV2:{...basic.nhlProV2,home:"SJ"}};
 assert.equal(rankResearchMoneylines(mismatch,{},now).candidates.length,0);
 const marketInformed={...basic,nhlProV2:{...basic.nhlProV2,marketInformed:true}};
 assert.equal(rankResearchMoneylines(marketInformed,{},now).candidates.length,0);
 const badPair={...basic,pinnoddsResearch:{offers:basic.pinnoddsResearch.offers.slice(0,1)}};
 assert.equal(rankResearchMoneylines(badPair,{},now).candidates.length,0);
});
test("qualified picks still use validated execution decision, independent of research evidence",()=>{
 const g={sport:"nfl",canQualify:true,canAuthorizeWager:true,rec:{pick:"SEA ML",market:"moneyline",side:"home"}};
 const v=bestValuePresentation(g,{sport:"nfl",decision:{evAvailable:true,ev:6.2,executionActionable:true,qualification:"QUALIFIED"}},{now});
 assert.equal(v.status,"qualified");
 assert.equal(v.value,"SEA ML");
 assert.match(v.detail,/6\.2%/);
 assert.equal(bestValuePresentation({...g,canAuthorizeWager:false},{sport:"nfl",decision:{evAvailable:true,ev:6.2,executionActionable:true,qualification:"QUALIFIED"}},{now}).status,"unpriced");
});
test("spread and total deltas never become research EV without outcome probability",()=>{
 const v=bestValuePresentation({sport:"nba",market:{spread:5}}, {sport:"nba",comparison:{sideDiff:10,totalDiff:12}},{now});
 assert.equal(v.status,"unpriced");
});

test('model directions show spread and total leans without inventing EV or authority',()=>{
 const vm={sport:'nba',home:{abbr:'BOS'},away:{abbr:'NYK'},projection:{available:true,home:113.4,away:98.4,total:211.8},market:{available:true,spread:-10,total:220}};
 const v=bestValuePresentation({sport:'nba'},vm,{now});assert.equal(v.value,'UNDER 220 LEAN');assert.match(v.detail,/BOS -10/);assert.match(v.detail,/FBIS 211.8/);assert.equal(v.qualified,false);assert.equal(v.executable,false);assert.doesNotMatch(v.detail,/ROI|EV/);
 const away=bestValuePresentation({sport:'nba'},{...vm,market:{available:true,spread:-20,total:211.8}},{now});assert.equal(away.value,'NYK +20 LEAN');
});
test('aligned lines explicitly say at the market line and missing lines retain model winner',()=>{
 const vm={home:{abbr:'BOS'},away:{abbr:'NYK'},projection:{available:true,home:113.4,away:98.4,total:211.8},market:{available:true,spread:-15,total:212}};
 const aligned=bestValuePresentation({sport:'nba'},vm,{now});assert.equal(aligned.value,'AT THE MARKET LINE');assert.match(aligned.detail,/SPREAD AT THE LINE.*TOTAL AT THE LINE/);
 const missing=bestValuePresentation({sport:'nba'},{...vm,market:{available:false}},{now});assert.equal(missing.value,'BOS PROJECTED WINNER');assert.match(missing.detail,/FBIS BOS -15.*TOTAL 211.8.*MARKET LINE UNAVAILABLE/);
 const noModel=bestValuePresentation({sport:'nba'},{...vm,projection:{available:false}},{now});assert.equal(noModel.value,'MODEL DIRECTION UNAVAILABLE');
});
test('market-informed or stored forecasts do not become independent model directions',()=>{
 const vm={projection:{available:true,home:110,away:100}};
 assert.notEqual(bestValuePresentation({sport:'nba',model:{marketInformed:true}},vm,{now}).status,'model');
 assert.notEqual(bestValuePresentation({sport:'nba',durableFallback:{statusUnverified:true}},vm,{now}).status,'model');
});

test('MLB stale-input status explains the missing direction and never promotes a blended probability',()=>{
 const g={sport:'mlb',pHome:.6008,pureProjectionAvailable:false,mlbDeepShadow:{ok:false,reason:'starter-or-team-offense-missing'},mlbPersistentState:{fresh:false,asOf:'2026-10-22T21:54Z'}};
 const v=bestValuePresentation(g,{projection:{available:false}},{now});
 assert.equal(v.value,'MLB INPUT REFRESH REQUIRED');assert.match(v.detail,/14-HOUR/);assert.match(v.secondary,/LAST PROFILE UPDATE/);assert.doesNotMatch(JSON.stringify(v),/60.1%|EST. ROI|MIL.*FAVORITE/);
 assert.equal(rankResearchMoneylines(g,{},now).candidates.length,0);
});
