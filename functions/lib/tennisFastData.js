/**
 * FBIS tennisfastR-style normalized research interface.
 * Provider-neutral, zero API fees. No network calls or implied source rights.
 * Callers supply independently collected, timestamped, source-attributed rows.
 */
import {calculateInhouseTennisElo,inhouseEloMatchProbability} from './tennisInhouseElo.js';
const time=x=>Date.parse(x||'');
const tours=new Set(['atp','wta']);
const surfaces=new Set(['hard','clay','grass']);
function select(rows,{tour,asOf}={}){
 if(!tours.has(tour)||!Number.isFinite(time(asOf)))throw Error('TOUR_AND_ASOF_REQUIRED');
 return rows.filter(x=>x.tour===tour&&Number.isFinite(time(x.observed_at))&&
  time(x.observed_at)<=time(asOf)&&Number.isFinite(time(x.match_time))&&
  time(x.match_time)<=time(asOf));
}
export function load_tennis_results(rows,options){
 return select(rows,options).filter(x=>x.completion_state==='FINAL'&&
 x.result_reason==='OFFICIAL_COMPLETED_SETS'&&x.source===options.tour.toUpperCase()+'_OFFICIAL'&&
 !!x.raw_artifact_key&&!!x.winner_id&&!!x.player1_id&&!!x.player2_id);
}
export function load_tennis_schedule(rows,{tour,asOf}={}){
 if(!tours.has(tour)||!Number.isFinite(time(asOf)))throw Error('TOUR_AND_ASOF_REQUIRED');
 return rows.filter(x=>x.tour===tour&&Number.isFinite(time(x.observed_at))&&
 time(x.observed_at)<=time(asOf)&&Number.isFinite(time(x.event_start_time))&&
 time(x.event_start_time)>time(asOf)&&x.player1_id&&x.player2_id);
}
export function load_tennis_player_stats(rows,{tour,asOf,playerId}={}){
 if(!playerId)throw Error('PLAYER_ID_REQUIRED');
 return select(rows,{tour,asOf}).filter(x=>x.player_id===playerId&&
 x.source_verified===true&&x.stat_status==='FINAL'&&
 Number.isFinite(Number(x.serve_points))&&Number(x.serve_points)>0);
}
export function load_tennis_elo(results,{tour,asOf}={}){
 return calculateInhouseTennisElo(load_tennis_results(results,{tour,asOf}),
 {asOf:new Date(asOf)});
}
export function load_tennis_h2h(results,{tour,asOf,player1,player2}={}){
 if(!player1||!player2||player1===player2)throw Error('PLAYER_PAIR_REQUIRED');
 const matches=load_tennis_results(results,{tour,asOf}).filter(x=>
 [x.player1_id,x.player2_id].includes(player1)&&[x.player1_id,x.player2_id].includes(player2));
 return {matches:matches.length,player1Wins:matches.filter(x=>x.winner_id===player1).length,
 player2Wins:matches.filter(x=>x.winner_id===player2).length,researchOnly:true};
}
export function load_tennis_form(results,{tour,asOf,playerId,limit=10}={}){
 if(!playerId||![5,10,20].includes(limit))throw Error('PLAYER_OR_LIMIT_INVALID');
 const matches=load_tennis_results(results,{tour,asOf}).filter(x=>
 [x.player1_id,x.player2_id].includes(playerId))
 .sort((a,b)=>time(b.match_time)-time(a.match_time)).slice(0,limit);
 return {matches:matches.length,wins:matches.filter(x=>x.winner_id===playerId).length,
 results:matches.map(x=>({matchId:x.match_id,won:x.winner_id===playerId,at:x.match_time})),
 researchOnly:true};
}
export function tennis_fast_matchup(results,{tour,asOf,player1,player2,surface}={}){
 const state=load_tennis_elo(results,{tour,asOf});
 return {tour,asOf,h2h:load_tennis_h2h(results,{tour,asOf,player1,player2}),
 form1:load_tennis_form(results,{tour,asOf,playerId:player1}),
 form2:load_tennis_form(results,{tour,asOf,playerId:player2}),
 surface:surfaces.has(surface)?surface:null,
 elo:inhouseEloMatchProbability(state,{tour,player1,player2,surface}),
 source:'VERIFIED_OFFICIAL_COMPLETED_MATCHES',canAuthorizeWager:false};
}
