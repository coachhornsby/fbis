import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichTennisExchangeHistoricalCards,exchangeHistoricalEstimate} from '../functions/lib/tennisExchangeHistoricalResearch.js';
const now=new Date('2026-10-21T14:00:00Z');
const mk=(name,id,kind='POLYMARKET_US_PUBLIC')=>({
 id,sport:'tennis',tour:'atp',start:'2026-10-21T20:00:00Z',
 home:{name},away:{name:'Tomas Machac'},
 tennisProjection:{researchFixture:{source:kind},eventIntegrity:{valid:false},
  player1WinProb:null,player2WinProb:null,venueOffers:[{source:'POLYMARKET_US_PUBLIC',contractPrice:.8}]},
 canQualify:false,canAuthorizeWager:false
});
const row=(name,surface,elo,n=25,overrides={})=>({
 tour:'atp',player_key:name.toLowerCase(),player_name:name,surface,
 profile_json:JSON.stringify({name,surfaceMatches:n,surfaceElo:{[surface]:elo}}),
 last_match_date:'2026-09-30',source:'SACKMANN_TENNIS_ABSTRACT_RESEARCH',
 source_license:'CC BY-NC-SA 4.0',
 source_as_of:'2026-10-14T00:00:00Z',
 updated_at:'2026-10-14T12:00:00Z',...overrides
});
function db(data){
 const queries=[];
 return {queries,prepare(sql){queries.push(sql);return {bind(tour,...keys){
  return {async all(){return {results:data.filter(x=>x.tour===tour&&keys.includes(x.player_key))};}};
 }};}};
}
test('exchange card uses stored historical profiles without creating FBIS model or betting edge',async()=>{
 const data=[row('Karen Khachanov','hard',1680),row('Karen Khachanov','clay',1550),
  row('Tomas Machac','hard',1610),row('Tomas Machac','clay',1540)];
 const d=db(data),game=mk('Karen Khachanov','tennis:polyus:atp:m1');
 const prior=JSON.stringify(game.tennisProjection.venueOffers);
 const result=await enrichTennisExchangeHistoricalCards(d,[game],{now});
 assert.equal(result.enriched,1);
 assert.equal(d.queries.length,1);
 assert.equal(game.tennisProjection.researchEstimate.source,'ALL_SURFACE_ELO_RESEARCH_ONLY');
 assert.ok(game.tennisProjection.researchEstimate.player1WinProb>0);
 assert.equal(game.tennisProjection.researchEstimate.marketInformed,false);
 assert.equal(game.tennisProjection.player1WinProb,null);
 assert.equal(game.tennisProjection.player2WinProb,null);
 assert.equal(game.tennisProjection.eventIntegrity.valid,false);
 assert.equal(game.canAuthorizeWager,false);
 assert.equal(JSON.stringify(game.tennisProjection.venueOffers),prior);
});
test('absence, stale cutoff and unlicensed records never generate percentages',async()=>{
 const data=[row('Karen Khachanov','hard',1680,25,{source_as_of:'2026-10-22T00:00:00Z'}),
  row('Tomas Machac','hard',1610)];
 const game=mk('Karen Khachanov','tennis:polyus:atp:m2');
 const result=await enrichTennisExchangeHistoricalCards(db(data),[game],{now});
 assert.equal(result.enriched,0);
 assert.equal(game.tennisProjection.researchEstimate,undefined);
 assert.equal(game.tennisProjection.historicalCoverage.matchedProfiles,1);
});
test('Kalshi contract expiration is not a verified prematch start',async()=>{
 const game=mk('Karen Khachanov','tennis:kalshi:atp:k','KALSHI_PUBLIC_SHADOW');
 game.startTimeBasis='KALSHI_CONTRACT_EXPIRATION_ONLY';
 const result=await enrichTennisExchangeHistoricalCards(db([
  row('Karen Khachanov','hard',1680),row('Tomas Machac','hard',1610)
 ]),[game],{now});
 assert.equal(result.enriched,0);
 assert.equal(game.tennisProjection.historicalCoverage.matchTimeVerified,false);
 assert.equal(game.tennisProjection.researchEstimate,undefined);
});
test('no market prices influence independent historical estimate',()=>{
 const a={elo:1690,matches:80,lastMatchDate:'2026-09-30',source:'SACKMANN_TENNIS_ABSTRACT_RESEARCH'};
 const b={elo:1620,matches:72,lastMatchDate:'2026-09-30',source:a.source};
 const x=exchangeHistoricalEstimate(a,b);
 assert.equal(x.player1WinProb+x.player2WinProb,1);
 assert.equal(x.canQualify,false);
 assert.equal(x.canAuthorizeWager,false);
});
