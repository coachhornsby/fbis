import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_TENNIS_ELO_SOURCE,
  currentTennisEloEstimate,
  loadValidatedCurrentTennisElo,
  loadCurrentTennisEloPlayers
} from '../functions/lib/tennisCurrentEloResearch.js';

const now=new Date('2026-10-21T21:00:00Z');
const hash='d'.repeat(64);
const receipt={
  tour:'atp',report_date:'2026-10-19',source_hash:hash,
  source_url:'https://www.tennisabstract.com/reports/atp_elo_ratings.html',
  source_label:'TENNIS_ABSTRACT_LIVE_ELO',
  player_count:102,retrieved_at:'2026-10-21T20:40:00Z',
  research_only:1,can_authorize_wager:0
};
const player=(name,overall,extra={})=>({
  tour:'atp',player_key:name.toLowerCase(),player_name:name,
  elo_rank:40,overall_elo:overall,hard_elo:overall+20,clay_elo:overall-10,grass_elo:overall-30,
  report_date:receipt.report_date,source_hash:hash,retrieved_at:receipt.retrieved_at,...extra
});
const raw=[player('Karen Khachanov',1800),player('Tomas Machac',1750),...Array.from({length:100},(_,i)=>player('Candidate Player '+i,1500-i))];
function storage({run=receipt,rows=raw}={}){
 const sql=[];
 return {sql,prepare(q){
  sql.push(q);
  return {bind(...args){
   return {async all(){
     if(q.includes('FROM tennis_abstract_elo_runs'))return {results:run?[run]:[]};
     return {results:rows.filter(r=>r.tour===args[0]&&r.report_date===args[1]&&r.source_hash===args[2]&&args.slice(3).includes(r.player_key))};
    },async first(){return {n:rows.filter(r=>r.tour===args[0]&&r.report_date===args[1]&&r.source_hash===args[2]).length}}};
  }};
 }};
}
test('complete fresh research-only receipt is validated, and only requested players are fetched',async()=>{
 const db=storage();
 const source=await loadValidatedCurrentTennisElo(db,{now});
 assert.equal(source.ok,true);
 await loadCurrentTennisEloPlayers(db,source,new Map([['atp',['karen khachanov','tomas machac']]]));
 assert.equal(source.players.size,2);
 const home=source.players.get('atp|karen khachanov'),away=source.players.get('atp|tomas machac');
 const estimate=currentTennisEloEstimate(home,away,{start:'2026-10-22T15:00:00Z',now});
 assert.equal(estimate.source,CURRENT_TENNIS_ELO_SOURCE);
 assert.equal(estimate.surface,null);
 assert.equal(estimate.reportDate,'2026-10-19');
 assert.equal(estimate.marketInformed,false);
 assert.equal(estimate.canAuthorizeWager,false);
 assert.equal(estimate.player1WinProb+estimate.player2WinProb,1);
 const hard=currentTennisEloEstimate(home,away,{start:'2026-10-22T15:00:00Z',now,surface:'hard'});
 assert.equal(hard.surface,'hard');
 assert.equal(hard.observations[0].elo,1820);
});
test('incomplete, stale, or non-research snapshot never qualifies as current',async()=>{
 for(const input of [
  {run:{...receipt,player_count:559}},
  {run:{...receipt,report_date:'2026-08-01'}},
  {run:{...receipt,research_only:0}},
  {run:{...receipt,can_authorize_wager:1}},
  {run:{...receipt,source_hash:'INVALID'}},
 ]){
  const result=await loadValidatedCurrentTennisElo(storage(input),{now});
  assert.equal(result.ok,false);
 }
});
test('post-start data, mismatched tour and player identity are rejected',async()=>{
 const a={...player('Karen Khachanov',1800),source:CURRENT_TENNIS_ELO_SOURCE,
  reportDate:'2026-10-19',retrievedAt:'2026-10-21T20:40:00Z'};
 const b={...player('Tomas Machac',1750),source:CURRENT_TENNIS_ELO_SOURCE,
  reportDate:'2026-10-19',retrievedAt:'2026-10-21T20:40:00Z'};
 assert.equal(currentTennisEloEstimate(a,b,{start:'2026-10-21T12:00:00Z',now}),null);
 assert.equal(currentTennisEloEstimate(a,{...b,tour:'wta'},{start:'2026-10-22T12:00:00Z',now}),null);
 assert.equal(currentTennisEloEstimate(a,{...b,player_key:a.player_key},{start:'2026-10-22T12:00:00Z',now}),null);
});
