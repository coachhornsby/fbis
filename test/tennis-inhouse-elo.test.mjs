import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateInhouseTennisElo,inhouseEloMatchProbability} from '../functions/lib/tennisInhouseElo.js';
const match=(id,time,winner='a',surface='hard')=>({
 match_id:id,tour:'wta',source:'WTA_OFFICIAL',completion_state:'FINAL',
 result_reason:'OFFICIAL_COMPLETED_SETS',source_winner_id:winner==='a'?'1':'2',
 raw_artifact_key:'tennis/wta/official-results/raw/'+id+'.json',
 player1_id:'a',player2_id:'b',winner_id:winner,match_time:time,
 observed_at:new Date(Date.parse(time)+7200000).toISOString(),surface
});
const times=Array.from({length:6},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0')+'T12:00:00Z');
test('Elo is deterministic, chronological, restricted sources ignored',()=>{
 const a=times.map((t,i)=>match('m'+i,t));
 const result=calculateInhouseTennisElo([...a].reverse(),{asOf:new Date('2026-10-20')});
 assert.equal(result.accepted,6);assert.equal(result.usesSackmann,false);
 assert.equal(result.ratings.find(x=>x.key==='wta|a|hard').n,6);
 assert.ok(inhouseEloMatchProbability(result,{tour:'wta',player1:'a',player2:'b',surface:'hard'}).p1>.5);
 const contaminated=[...a,{...match('bad','2026-10-09T12:00:00Z'),match_id:'bad',source:'TENNIS_ABSTRACT'}];
 assert.equal(calculateInhouseTennisElo(contaminated,{asOf:new Date('2026-10-20')}).accepted,6);
});
test('no future results or missing surface cohort affect ratings',()=>{
 const rows=[...times.map((t,i)=>match('m'+i,t)),match('future','2026-10-25T12:00:00Z')];
 const out=calculateInhouseTennisElo(rows,{asOf:new Date('2026-10-20')});
 assert.equal(out.accepted,6);
 assert.equal(inhouseEloMatchProbability(out,{tour:'wta',player1:'a',player2:'b',surface:'clay'}),null);
 assert.equal(inhouseEloMatchProbability(out,{tour:'wta',player1:'a',player2:'b',surface:'hard'}).canAuthorizeWager,false);
});
