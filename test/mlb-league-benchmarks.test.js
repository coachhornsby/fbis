import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMlbLeagueDay,poolMlbLeagueDays} from '../functions/lib/mlbLeagueBenchmarks.js';
const header='pitch_type,game_date,game_type,game_pk,pitcher,batter,at_bat_number,pitch_number,type,description,events,stand,estimated_woba_using_speedangle,launch_speed,launch_speed_angle';
const csv=(date,values)=>header+'\n'+values.map((x,i)=>`FF,${date},R,1,11,21,${i+1},1,X,hit_into_play,field_out,L,${x},0,1`).join('\n');
const day=(date,values)=>buildMlbLeagueDay({date,rawCsv:csv(date,values),finalGameIds:['1'],observedAt:'2026-10-24T12:00:00Z'}).summary;
test('league scope uses the full supplied final-game universe, preserves zeroes and hand splits',()=>{
 const s=day('2026-10-23',[0]);assert.equal(s.complete,true);const left=s.cohorts.find(c=>c.scope==='regular'&&c.hand==='L');assert.equal(left.metrics.xwobacon.value,0);assert.equal(left.pitches,1);assert.equal(s.cohorts.find(c=>c.hand==='R').metrics.xwobacon.value,null);
});
test('pooling sums operands rather than taking average of daily averages',()=>{
 const a=day('2026-10-22',[0]),b=day('2026-10-23',[1,1,1]),p=poolMlbLeagueDays([a,b]);assert.equal(p.cohorts[0].metrics.xwobacon.value,.75);assert.throws(()=>poolMlbLeagueDays([a,a]));
});
test('missing final games prevent coverage completion; identity and future dates reject',()=>{
 const options={date:'2026-10-23',rawCsv:csv('2026-10-23',[.5]),finalGameIds:['1','2'],observedAt:'2026-10-24T12:00:00Z'};const d=buildMlbLeagueDay(options);assert.equal(d.summary.complete,false);assert.deepEqual(d.summary.missingGameIds,['2']);
 assert.throws(()=>buildMlbLeagueDay({...options,date:'2026-10-24'}));assert.throws(()=>buildMlbLeagueDay({...options,finalGameIds:['99']}));
});
