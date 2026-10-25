import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFixtureCoverage,assessPropCoverage,verifiedCurrentQuote,marketFamilyEvidence,independentlyProjectedGame,summarizeReliability} from '../scripts/lib/fbisAutoRepairPolicy.mjs';
const now=Date.parse('2026-10-25T18:00:00Z'),start='2026-10-25T19:00:00Z';
const game={id:'g1',sport:'nfl',start,status:'scheduled',projectionUnavailable:false,
 projectionKind:'FBIS',projHome:24,projAway:21,
 market:{venueOffers:[
  ...['moneyline','spread','total'].flatMap(marketFamily=>
   (marketFamily==='total'?['over','under']:['home','away']).map(side=>({
    source:'Verified Test',sourceMarketId:'m-'+marketFamily,marketFamily,side,
    period:'full_game',line:marketFamily==='spread'?3.5:marketFamily==='total'?44.5:null,
    contractPrice:.54,marketAvailable:true,priceVerified:true,providerTimestampVerified:true,
    sourceObservedAt:'2026-10-25T17:40:00Z'})))]}};
const player={sport:'nfl',canonicalEventId:'g1',canonicalPlayerId:'nfl:espn:42',canonical_market:'receptions',
 period:'full_game',identityVerified:true,independent:true,marketInformed:false,fbis_projection:5.2,modelId:'m',modelVersion:'v1'};
const contract={...player,id:'c1',contractId:'k123',line:4.5,provider:'Kalshi',observedAt:'2026-10-25T17:40:00Z',
 marketAvailable:true,priceVerified:true,providerTimestampVerified:true};
test('all-sport game audit requires timestamped current odds and independent model',()=>{
 const r=assessFixtureCoverage({games:[game,{...game,id:'g2',sport:'soccer',market:{venueOffers:[]},projectionUnavailable:true}]},{now});
 assert.equal(r.counts.activeGames,2);assert.equal(r.counts.currentMarketGames,1);
 assert.equal(r.findings.filter(f=>f.kind==='GAME_ODDS').length,1);
 assert.equal(r.findings.filter(f=>f.kind==='MODELS').length,1);
});
test('reference price, old quote, and postgame card never count as current',()=>{
 assert.equal(verifiedCurrentQuote({...contract,priceVerified:false},now),false);
 assert.equal(verifiedCurrentQuote({...contract,observedAt:'2026-10-25T08:00:00Z'},now),false);
 const r=assessFixtureCoverage({games:[{...game,market:{venueOffers:[{...contract,priceVerified:false}]}},
   {...game,id:'final',status:'final'}]},{now});
 assert.equal(r.counts.activeGames,1);assert.equal(r.counts.currentMarketGames,0);
});
test('prop audit joins exact player/event/stat, not loosely by athlete',()=>{
 const x=assessPropCoverage({sport:'nfl',games:[game],models:[player],contracts:[contract],now});
 assert.equal(x.counts.matchedContracts,1);assert.equal(x.counts.matchedCurrentQuotes,1);
 const miss=assessPropCoverage({sport:'nfl',games:[game],models:[player],contracts:[{...contract,canonical_market:'receiving_yards'}],now});
 assert.equal(miss.counts.unmatchedContracts,1);assert.equal(miss.counts.projectionsWithoutMarket,1);
 assert.equal(miss.findings.some(f=>f.reason==='PLAYER_PROP_MODEL_NOT_MATCHED'),true);
});
test('no provider offerings cannot masquerade as a verified price',()=>{
 const x=assessPropCoverage({sport:'nba',games:[{...game,sport:'nba'}],models:[],contracts:[],now});
 assert.equal(x.findings[0].reason,'NO_VERIFIED_PROVIDER_PROP_CONTRACTS');
 const summary=summarizeReliability([x],{date:'2026-10-25'});
 assert.equal(summary.canAuthorizeWager,false);assert.equal(summary.paidProviderCalls,0);
});

test('unknown local capture clocks do not masquerade as provider-verified game or prop odds',()=>{
 const quote={marketAvailable:true,priceVerified:true,sourceObservedAt:'2026-10-25T17:55:00Z'};
 assert.equal(verifiedCurrentQuote(quote,now),false);
 assert.equal(verifiedCurrentQuote({...quote,providerTimestampVerified:true},now),true);
});
test('game cards track missing spread and total separately from one valid moneyline',()=>{
 const onlyMoneyline={...game,market:{venueOffers:game.market.venueOffers.slice(0,2)}};
 const x=assessFixtureCoverage({games:[onlyMoneyline]},{now});
 assert.deepEqual(x.games[0].missingFamilies,['spread','total']);
 assert.ok(x.findings.some(f=>f.reason==='CURRENT_MARKET_FAMILY_INCOMPLETE'&&
  f.missingFamilies.includes('spread')&&f.missingFamilies.includes('total')));
 const tennis=assessFixtureCoverage({games:[{...game,sport:'tennis'}]},{now});
 assert.equal(tennis.games[0].missingFamilies.length,0);
});

test('one verified spread outcome cannot pass a two-sided market, even with a timestamp',()=>{
 const result=marketFamilyEvidence(game.market.venueOffers.filter(o=>o.marketFamily==='spread').slice(0,1),'spread',{now});
 assert.equal(result.verifiedOutcomes,1);
 assert.equal(result.verifiedPairs,0);
 assert.equal(result.state,'UNPAIRED_CURRENT_MARKET');
});
test('second half and alternate-market sides cannot satisfy full-game totals',()=>{
 const offers=game.market.venueOffers.filter(o=>o.marketFamily==='total').map(x=>({...x,period:'second_half'}));
 assert.equal(marketFamilyEvidence(offers,'total',{now}).state,'PERIOD_NOT_FULL_GAME');
 const distinct=game.market.venueOffers.filter(o=>o.marketFamily==='total').map((x,i)=>({...x,sourceMarketId:'other-'+i}));
 assert.equal(marketFamilyEvidence(distinct,'total',{now}).verifiedPairs,0);
});
test('strict model delivery accepts independently verified tennis probability only',()=>{
 const t={sport:'tennis',tennisProjection:{eventIntegrity:{valid:true},player1WinProb:.61,player2WinProb:.39}};
 assert.equal(independentlyProjectedGame(t),true);
 assert.equal(independentlyProjectedGame({...t,tennisProjection:{...t.tennisProjection,eventIntegrity:{valid:false}}}),false);
 assert.equal(independentlyProjectedGame({...game,projectionKind:'PINNACLE_IMPLIED'}),false);
});

test('provider-timed Polymarket US research BBO can count as current observed odds without a wager grant',()=>{
 const safe={source:'Polymarket US WebSocket',sourceMarketId:'m',sourceObservedAt:'2026-10-25T17:40:00Z',
  providerTimestampVerified:true,priceVerified:true,identityVerified:true,marketAvailable:false,
  observedReferenceCurrent:true,temporal:{status:'CURRENT'},executionEligible:false,canAuthorizeWager:false,
  contractPrice:.55};
 assert.equal(verifiedCurrentQuote(safe,now),true);
 assert.equal(verifiedCurrentQuote({...safe,canAuthorizeWager:true},now),false);
 assert.equal(verifiedCurrentQuote({...safe,providerTimestampVerified:false},now),false);
 assert.equal(verifiedCurrentQuote({...safe,temporal:{status:'STALE'}},now),false);
});
test('soccer full-time moneyline requires home draw and away from same provider market',()=>{
 const common={source:'Test Provider',sourceMarketId:'1x2',marketFamily:'moneyline',period:'full_game',
  marketAvailable:true,priceVerified:true,providerTimestampVerified:true,contractPrice:.33,
  sourceObservedAt:'2026-10-25T17:50:00Z'};
 const homeAway=[{...common,side:'home'},{...common,side:'away'}];
 assert.equal(marketFamilyEvidence(homeAway,'moneyline',{now,sport:'soccer'}).available,false);
 assert.equal(marketFamilyEvidence([...homeAway,{...common,side:'draw'}],'moneyline',{now,sport:'soccer'}).available,true);
});
