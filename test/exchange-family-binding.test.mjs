import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedFullGameDisplayBinding} from '../services/polymarket-rest-collector/collector.mjs';
import {polymarketUsMarketOffers,polymarketUsMarketFamily} from '../functions/lib/polymarketUs.js';

const fixture={id:'nba-1',home_name:'Atlanta Hawks',away_name:'Washington Wizards',
  home_abbr:'ATL',away_abbr:'WSH',start:'2026-11-07T01:00:00.000Z'};
const event=(m)=>({id:'source-1',startTime:fixture.start,seriesSlug:'nba',
  title:'Washington Wizards vs Atlanta Hawks',homeTeam:{name:'Atlanta Hawks'},
  awayTeam:{name:'Washington Wizards'},markets:[m]});
const make=(family,description,line,type='nba_full_game_total')=>{
 const market={id:'source-'+family,slug:'nba-'+family+'-contract',
 sportsMarketType:type,sportsMarketTypeV2:family==='spread'?'SPORTS_MARKET_TYPE_SPREAD':
 family==='total'?'SPORTS_MARKET_TYPE_TOTAL':'SPORTS_MARKET_TYPE_MONEYLINE',
 line,marketSides:[{id:'source-outcome-'+family,description,long:true,
   team:description.includes('Atlanta')?{name:'Atlanta Hawks'}:undefined,quote:{value:'0.52'}}]};
 return polymarketUsMarketOffers(event(market),'nba',{canonicalId:'nba-1'})[0];
};
test('source-confirmed full-game spread binds exact team and its signed line',()=>{
 const offer=make('spread','Atlanta Hawks +3.5',3.5,'nba_full_game_spread');
 assert.equal(offer.marketFamily,'spread');
 assert.deepEqual(verifiedFullGameDisplayBinding(offer,fixture),{
  version:1,contractLong:true,period:'full_game',sourceOutcomeId:'source-outcome-spread',side:'home',line:3.5
 });
 for(const bad of [
  {...offer,line:4.5},
  {...offer,period:'first_half'},
  {...offer,raw:{...offer.raw,contractLong:false}},
  {...offer,raw:{...offer.raw,providerSide:{description:'Atlanta Hawks'}}},
  {...offer,raw:{...offer.raw,providerSide:{description:'Unknown team +3.5',team:{name:'Unknown team'}}}},
 ])assert.equal(verifiedFullGameDisplayBinding(bad,fixture),null);
});
test('source-confirmed full-game total binds Over/Under at its exact threshold',()=>{
 for(const side of ['Over','Under']){
  const offer=make('total',side,226.5,'nba_full_game_total');
  assert.equal(offer.marketFamily,'total');
  assert.deepEqual(verifiedFullGameDisplayBinding(offer,fixture),{
   version:1,contractLong:true,period:'full_game',sourceOutcomeId:'source-outcome-total',side:side.toLowerCase(),line:226.5
  });
 }
 const offer=make('total','Over',226.5);
 assert.equal(verifiedFullGameDisplayBinding({...offer,line:null},fixture),null);
 assert.equal(verifiedFullGameDisplayBinding({...offer,side:'Unknown',raw:{...offer.raw,providerSide:{description:'Unknown'}}},fixture),null);
});
test('team totals never masquerade as full-game totals',()=>{
 assert.equal(polymarketUsMarketFamily({sportsMarketType:'nba_full_game_team_total'}),'team_total');
 assert.equal(polymarketUsMarketFamily({sportsMarketTypeV2:'SPORTS_MARKET_TYPE_TEAM_TOTAL'}),'team_total');
 const market=make('total','Over',114.5,'nba_full_game_team_total');
 assert.equal(market.marketFamily,'team_total');
 assert.equal(verifiedFullGameDisplayBinding(market,fixture),null);
});
