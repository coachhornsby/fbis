import test from 'node:test';
import assert from 'node:assert/strict';
import {buildArchivedMatchup} from '../functions/lib/mlbArchivedMatchup.js';
import {buildMlbStatcastLab} from '../functions/lib/mlbStatcastLab.js';
const scope={pitcherId:'1',batterId:'2',asOf:'2025-06-01',pitcherHand:'R',batterHand:'L'};
const rows=Array.from({length:240},(_,i)=>({pitcher:'1',batter:'2',game_date:'2025-05-01',game_type:'R',game_pk:'1',at_bat_number:String(Math.floor(i/4)),pitch_number:String(i%4+1),stand:'L',p_throws:'R',pitch_type:'FF',type:i%4===3?'X':'S',description:i%4===3?'hit_into_play':'swinging_strike',events:i%4===3?'field_out':'',zone:5,launch_speed:i%4===3?100:null,launch_angle:i%4===3?20:null,estimated_ba_using_speedangle:i%4===3?.6:null,estimated_slg_using_speedangle:i%4===3?1.2:null,estimated_woba_using_speedangle:i%4===3?.7:null,launch_speed_angle:i%4===3?6:null}));
const packet=role=>({role,playerId:role==='pitcher'?'1':'2',season:2025,rows});
test('candidate reads both exact identities and handedness, excludes future rows and duplicates',()=>{
 const p=packet('pitcher'),b=packet('batter');p.rows=[...rows,...rows,...rows.map(r=>({...r,game_date:'2025-06-01',game_pk:'2'}))];
 const result=buildArchivedMatchup({...scope,pitcherPackets:[p],batterPackets:[b]});assert.equal(result.status,'CANDIDATE');assert.equal(result.coverage.pitcher.pitches,240);assert.equal(result.coverage.batter.plateAppearances,60);assert.equal(result.canAuthorizeWager,false);assert.equal(result.productionProjectionChanged,false);
 const mismatch=buildArchivedMatchup({...scope,pitcherHand:'L',pitcherPackets:[p],batterPackets:[b]});assert.equal(mismatch.candidate,null);assert.ok(mismatch.reasons.includes('BATTER_SAMPLE'));
});
test('empty or wrong-identity archives cannot manufacture a candidate',()=>{assert.equal(buildArchivedMatchup(scope).candidate,null);assert.equal(buildArchivedMatchup({...scope,pitcherPackets:[{...packet('pitcher'),playerId:'99'}],batterPackets:[packet('batter')]}).candidate,null);assert.throws(()=>buildArchivedMatchup({...scope,asOf:'2025-02-31'}));assert.throws(()=>buildArchivedMatchup({...scope,pitcherHand:'all'}));});
test('hitter contact metrics use measured batted balls, retaining zero and missing values',()=>{
 const b=packet('batter');b.rows=[...rows,{...rows[3],at_bat_number:'99',estimated_ba_using_speedangle:0,estimated_slg_using_speedangle:null}];const lab=buildMlbStatcastLab([b],{season:2025});assert.equal(lab.metrics.xbaContact.denominator,61);assert.equal(lab.metrics.xslgContact.denominator,60);assert.equal(lab.metrics.launchAngle.value,20);assert.ok(Math.abs(lab.metrics.xbaContact.value-36/61)<1e-9);
});
test('automatic walks remain PAs while truncated and runner events do not',()=>{
 const extra=[{...rows[0],at_bat_number:'91',description:'automatic_ball',events:'walk'},{...rows[0],at_bat_number:'92',events:'truncated_pa'},{...rows[0],at_bat_number:'93',events:'caught_stealing_2b'}];const p={...packet('pitcher'),rows:[...rows,...extra]};const result=buildArchivedMatchup({...scope,pitcherPackets:[p],batterPackets:[packet('batter')]});assert.equal(result.coverage.pitcher.plateAppearances,61);assert.equal(result.coverage.pitcher.pitches,242);
});
