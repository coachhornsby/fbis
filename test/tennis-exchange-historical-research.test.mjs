import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichTennisExchangeHistoricalCards,exchangeHistoricalEstimate} from '../functions/lib/tennisExchangeHistoricalResearch.js';
const now=new Date('2026-10-21T21:00:00Z');
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
function db(data,{live=[],receipts=[]}={}){
 const queries=[];
 return {queries,prepare(sql){queries.push(sql);return {bind(...args){
  if(sql.includes('COUNT(*) n FROM tennis_abstract_elo_players'))return {
    async first(){const [tour,date,hash]=args;return {n:live.filter(r=>r.tour===tour&&r.report_date===date&&r.source_hash===hash).length};}
  };
  return {async all(){
    if(sql.includes('FROM tennis_abstract_elo_runs'))return {results:receipts};
    if(sql.includes('FROM tennis_abstract_elo_players'))return {results:live.filter(r=>
      r.tour===args[0]&&r.report_date===args[1]&&r.source_hash===args[2]&&args.slice(3).includes(r.player_key))};
    return {results:data.filter(x=>x.tour===args[0]&&args.slice(1).includes(x.player_key))};
  }};
 }};}};
}
test('exchange card uses stored historical profiles without creating FBIS model or betting edge',async()=>{
 const data=[row('Karen Khachanov','hard',1680),row('Karen Khachanov','clay',1550),
  row('Tomas Machac','hard',1610),row('Tomas Machac','clay',1540)];
 const d=db(data),game=mk('Karen Khachanov','tennis:polyus:atp:m1');
 const prior=JSON.stringify(game.tennisProjection.venueOffers);
 const result=await enrichTennisExchangeHistoricalCards(d,[game],{now});
 assert.equal(result.enriched,1);
 assert.ok(d.queries.some(q=>q.includes('tennis_player_profiles_current')));
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

const digest='a'.repeat(64);
const names=['Karen Khachanov','Tomas Machac'];
function fixtureLive(name,overall,tour='atp'){
 return {tour,player_key:name.toLowerCase(),player_name:name,elo_rank:10,
  overall_elo:overall,hard_elo:overall+10,clay_elo:overall-20,grass_elo:overall-30,
  report_date:'2026-10-19',source_hash:digest,retrieved_at:'2026-10-21T20:40:59Z'};
}
const liveNames=[fixtureLive('Karen Khachanov',1820),fixtureLive('Tomas Machac',1780)];
function liveDb(){
 const fake=[...liveNames];
 const filler=Array.from({length:100},(_,i)=>fixtureLive('Research Player '+i,1600-i));
 const live=[...fake,...filler];
 const receipts=[{tour:'atp',report_date:'2026-10-19',source_hash:digest,
  source_url:'https://www.tennisabstract.com/reports/atp_elo_ratings.html',
  source_label:'TENNIS_ABSTRACT_LIVE_ELO',player_count:live.length,
  retrieved_at:'2026-10-21T20:40:59Z',research_only:1,can_authorize_wager:0}];
 return db([row('Karen Khachanov','hard',1650),row('Tomas Machac','hard',1620)],{live,receipts});
}
test('validated current Elo is primary over historical Sackmann without model authorization',async()=>{
 const card=mk('Karen Khachanov','tennis:polyus:atp:live');
 const original=JSON.stringify(card.tennisProjection.venueOffers);
 const result=await enrichTennisExchangeHistoricalCards(liveDb(),[card],{now});
 assert.equal(result.currentPrimary,1);
 assert.equal(result.historicalFallback,0);
 assert.equal(card.tennisProjection.researchEstimate.source,'TENNIS_ABSTRACT_CURRENT_ELO_RESEARCH_ONLY');
 assert.equal(card.tennisProjection.researchEstimate.reportDate,'2026-10-19');
 assert.equal(card.tennisProjection.researchEstimate.surface,null);
 assert.equal(card.tennisProjection.researchEstimate.canAuthorizeWager,false);
 assert.equal(card.tennisProjection.eventIntegrity.valid,false);
 assert.equal(card.tennisProjection.player1WinProb,null);
 assert.equal(card.tennisProjection.player2WinProb,null);
 assert.equal(JSON.stringify(card.tennisProjection.venueOffers),original);
});
test('live source not published or incomplete falls back to older source',async()=>{
 const data=[row('Karen Khachanov','hard',1680),row('Tomas Machac','hard',1600)];
 const live=[fixtureLive('Karen Khachanov',1800),fixtureLive('Tomas Machac',1760)];
 const badReceipt={tour:'atp',report_date:'2026-10-19',source_hash:digest,
  source_url:'https://www.tennisabstract.com/reports/atp_elo_ratings.html',
  player_count:559,retrieved_at:'2026-10-21T20:40:59Z',research_only:1,can_authorize_wager:0};
 const card=mk('Karen Khachanov','tennis:polyus:atp:incomplete');
 const result=await enrichTennisExchangeHistoricalCards(db(data,{live,receipts:[badReceipt]}),[card],{now});
 assert.equal(result.currentPrimary,0);
 assert.equal(result.historicalFallback,1);
 assert.equal(card.tennisProjection.researchEstimate.source,'ALL_SURFACE_ELO_RESEARCH_ONLY');
});
