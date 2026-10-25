import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFixtureCoverage,assessPropCoverage,verifiedCurrentQuote,summarizeReliability} from '../scripts/lib/fbisAutoRepairPolicy.mjs';
const now=Date.parse('2026-10-25T18:00:00Z'),start='2026-10-25T19:00:00Z';
const game={id:'g1',sport:'nfl',start,status:'scheduled',projectionUnavailable:false,projectionKind:'FBIS',
 market:{venueOffers:[{marketAvailable:true,priceVerified:true,providerTimestampVerified:true,
  marketFamily:'moneyline',sourceObservedAt:'2026-10-25T17:40:00Z'}]}};
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
 const x=assessFixtureCoverage({games:[game]},{now});
 assert.deepEqual(x.games[0].missingFamilies,['spread','total']);
 assert.ok(x.findings.some(f=>f.reason==='CURRENT_MARKET_FAMILY_MISSING'));
 const tennis=assessFixtureCoverage({games:[{...game,sport:'tennis'}]},{now});
 assert.equal(tennis.games[0].missingFamilies.length,0);
});
