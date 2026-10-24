import test from 'node:test';
import assert from 'node:assert/strict';
import {load_tennis_results,load_tennis_schedule,load_tennis_form,load_tennis_h2h,
 load_tennis_elo,load_tennis_player_stats,tennis_fast_matchup} from '../functions/lib/tennisFastData.js';
const start='2026-10-10T10:00:00Z',seen='2026-10-10T13:00:00Z';
const row=(i)=>({tour:'atp',source:'ATP_OFFICIAL',match_id:'m'+i,
 player1_id:'1',player2_id:'2',winner_id:'1',source_winner_id:'1',
 completion_state:'FINAL',result_reason:'OFFICIAL_COMPLETED_SETS',
 raw_artifact_key:'tennis/atp/official-results/raw/m'+i+'.json',
 match_time:'2026-10-'+String(i+1).padStart(2,'0')+'T10:00:00Z',
 observed_at:'2026-10-'+String(i+1).padStart(2,'0')+'T13:00:00Z',surface:'hard'});
const rows=Array.from({length:6},(_,i)=>row(i));
test('results, form and Elo exclude late or future information',()=>{
 const all=[...rows,{...row(9),match_id:'future',observed_at:'2026-10-25T10:00:00Z'}];
 const opts={tour:'atp',asOf:'2026-10-20T00:00:00Z'};
 assert.equal(load_tennis_results(all,opts).length,6);
 assert.equal(load_tennis_form(all,{...opts,playerId:'1',limit:5}).wins,5);
 assert.equal(load_tennis_h2h(all,{...opts,player1:'1',player2:'2'}).matches,6);
 assert.equal(load_tennis_elo(all,opts).accepted,6);
 assert.ok(tennis_fast_matchup(all,{...opts,player1:'1',player2:'2',surface:'hard'}).elo.p1>.5);
});
test('schedule and stats require observed provenance',()=>{
 const asOf='2026-10-20T00:00:00Z';
 assert.equal(load_tennis_schedule([{tour:'wta',observed_at:seen,
 event_start_time:'2026-10-21T10:00:00Z',player1_id:'a',player2_id:'b'}],
 {tour:'wta',asOf}).length,1);
 assert.equal(load_tennis_player_stats([{tour:'wta',observed_at:seen,match_time:start,
 player_id:'a',source_verified:true,stat_status:'FINAL',serve_points:60}],
 {tour:'wta',asOf,playerId:'a'}).length,1);
 assert.equal(load_tennis_player_stats([{tour:'wta',observed_at:seen,match_time:start,
 player_id:'a',source_verified:false,stat_status:'FINAL',serve_points:60}],
 {tour:'wta',asOf,playerId:'a'}).length,0);
});
