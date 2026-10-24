import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLabRows,buildMlbStatcastLab,labApproachAngles,finiteLab} from '../functions/lib/mlbStatcastLab.js';
import {persistLabPacket,readLabPackets} from '../functions/lib/mlbStatcastLabStore.js';
import {onRequestGet,onRequestPost} from '../functions/api/mlb-statcast-lab.js';
const row=(extra={})=>({pitch_type:'FF',game_date:'2024-05-01',game_type:'R',game_pk:'1',at_bat_number:'1',pitch_number:'1',pitcher:'669373',batter:'592450',stand:'L',p_throws:'L',type:'S',description:'swinging_strike',events:'strikeout',zone:11,plate_x:1.3,plate_z:2.5,sz_bot:1.5,sz_top:3.5,release_speed:97,release_spin_rate:2300,release_pos_x:1.3,release_pos_z:6.1,release_pos_y:54,release_extension:6.4,vx0:0,vy0:-100,vz0:-10,ax:0,ay:0,az:0,...extra});
const normalize=(rows,extra={})=>normalizeLabRows(rows,{playerId:'669373',role:'pitcher',season:2024,cutoffDay:'2026-10-24',...extra});
const packet=(rows,season=2024)=>({playerId:'669373',role:'pitcher',season,rows:normalize(rows,{season}).rows,observedAt:'2026-10-24T00:00:00Z',games:2,cutoffDay:'2026-10-24'});
test('source normalization rejects identity, future, spring and unfinalized games, deduplicates exact pitches, preserves measured zero',()=>{
 const result=normalize([row({release_speed:0}),row(),row({pitch_number:2,pitcher:'123'}),row({pitch_number:3,game_type:'S'}),row({game_pk:'2'})],{finalGameIds:new Set(['1'])});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].release_speed,0);assert.deepEqual(result.rejections,{identity:1,scope:1,duplicate:1,game:1});assert.equal(finiteLab(' '),null);
});
test('Chase, SwStr and whiff use distinct valid denominators; xwOBACON does not use non-contact pitches',()=>{
 const rows=[row(),row({pitch_number:2,at_bat_number:2,type:'X',description:'hit_into_play',events:'single',zone:5,launch_speed:100,launch_speed_angle:6,estimated_woba_using_speedangle:.8}),row({pitch_number:3,at_bat_number:3,type:'B',description:'ball',events:'walk',zone:null,plate_x:null})];
 const lab=buildMlbStatcastLab([packet(rows)],{season:2024});assert.equal(lab.metrics.chase.value,1);assert.equal(lab.metrics.chase.denominator,1);assert.equal(lab.metrics.swstr.value,1/3);assert.equal(lab.metrics.whiff.value,.5);assert.equal(lab.metrics.xwobacon.value,.8);assert.equal(lab.metrics.xwobacon.denominator,1);assert.equal(lab.metrics.barrel.value,1);assert.equal(lab.metrics.strikeout.value,1/3);assert.equal(lab.canAuthorizeWager,false);
});
test('handedness usage sums within the actual hand sample; unknown hand is not reassigned',()=>{
 const lab=buildMlbStatcastLab([packet([row(),row({pitch_number:2,pitch_type:'CH',stand:'R'}),row({pitch_number:3,stand:''})])],{season:2024,hand:'L'});
 assert.equal(lab.pitches,1);assert.deepEqual(lab.handedness.map(h=>h.pitches),[1,1]);assert.equal(lab.handedness[1].arsenal[0].type,'CH');assert.equal(lab.handedness[1].arsenal[0].usage.value,1);
});
test('PA result filters include earlier pitches from that exact PA; postseason excludes regular season and vice versa',()=>{
 const rows=[row({events:'',description:'ball',type:'B'}),row({pitch_number:2,description:'hit_into_play',type:'X',events:'single'}),row({game_pk:'2',game_type:'F',at_bat_number:2,events:'strikeout'})];
 assert.equal(buildMlbStatcastLab([packet(rows)],{season:2024,paResult:'single'}).pitches,2);assert.equal(buildMlbStatcastLab([packet(rows)],{season:2024,scope:'postseason'}).pitches,1);assert.equal(buildMlbStatcastLab([packet(rows)],{season:2024,scope:'regular'}).pitches,2);
});
test('unmeasured release and expected metrics stay null; trend gaps never become zeroes',()=>{
 const r=row({estimated_woba_using_speedangle:'',release_pos_x:'',release_pos_z:''});const lab=buildMlbStatcastLab([packet([r])],{season:2024});assert.equal(lab.metrics.xwobacon.value,null);assert.equal(lab.arsenal[0].release.x.value,null);assert.equal(lab.trends[0].categories.find(c=>c.category==='offspeed').metrics.chase.value,null);
});
test('heatmap uses catcher-view x without mirroring and normalized individual strike-zone height',()=>{
 const lab=buildMlbStatcastLab([packet([row({plate_x:-1.5,plate_z:2.5}),row({pitch_number:2,plate_x:4})])],{season:2024});assert.equal(lab.heatmap.cells.find(c=>c.count).x,1);assert.equal(lab.heatmap.cells.reduce((s,c)=>s+c.count,0),1);assert.equal(lab.heatmap.offGrid,1);
});
test('approach-angle calculation has documented plane and rejects impossible or missing trajectories',()=>{
 const a=labApproachAngles(row());assert.equal(a.haa,0);assert.ok(Math.abs(a.vaa+5.7105931375)<1e-8);assert.equal(labApproachAngles(row({vy0:100})),null);assert.equal(labApproachAngles(row({az:''})),null);
});
function bucket(){const map=new Map();return {map,async get(key){if(!map.has(key))return null;const bytes=map.get(key);return {body:new Blob([bytes]).stream(),json:async()=>JSON.parse(new TextDecoder().decode(bytes))};},async put(key,value,options){if(options?.onlyIf?.get('If-None-Match')==='*'&&map.has(key))return null;map.set(key,typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value));return {key};}};}
const csv=rows=>{const keys=Object.keys(row());return keys.map(k=>`"${k}"`).join(',')+'\n'+rows.map(r=>keys.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(',')).join('\n');};
test('archive ingestion is exact-ID scoped, immutable on retry, and readback verifies its content hash',async()=>{
 const ARCHIVE=bucket(),payload={playerId:'669373',role:'pitcher',season:2024,cutoffDay:'2026-10-24',rawCsv:csv([row()]),finalGameIds:['1'],sourceUrl:'https://baseballsavant.mlb.com/statcast_search/csv?player_type=pitcher&pitchers_lookup[]=669373'};
 const first=await persistLabPacket({ARCHIVE},payload),bytes=ARCHIVE.map.get(first.key).slice(),again=await persistLabPacket({ARCHIVE},{...payload,observedAt:'2026-10-25T00:00Z'});assert.equal(again.reused,true);assert.deepEqual(ARCHIVE.map.get(first.key),bytes);assert.equal(ARCHIVE.map.size,3);
 const read=await readLabPackets({ARCHIVE},{playerId:'669373',role:'pitcher',seasons:[2024,2025]});assert.equal(read.packets.length,1);assert.ok(read.diagnostics.includes('2025:NOT_COLLECTED'));
 await assert.rejects(()=>persistLabPacket({ARCHIVE},{...payload,playerId:'123'}));
 ARCHIVE.map.set(first.key,new Uint8Array([1,2,3]));assert.equal((await readLabPackets({ARCHIVE},{playerId:'669373',role:'pitcher',seasons:[2024]})).packets.length,0);
});
test('public reads do not acquire source data; writes require the operator header and exact player/year',async()=>{
 const r=await onRequestGet({env:{},request:new Request('https://fbis.test/api/mlb-statcast-lab?playerId=669373&season=2024')});const b=await r.json();assert.equal(b.ok,true);assert.equal(b.available,false);assert.ok(b.diagnostics.includes('ARCHIVE_UNBOUND'));
 const denied=await onRequestPost({env:{HARVEST_SECRET:'test'},request:new Request('https://fbis.test/api/mlb-statcast-lab',{method:'POST',body:'{}'})});assert.equal(denied.status,403);
 assert.equal((await onRequestGet({env:{},request:new Request('https://fbis.test/api/mlb-statcast-lab?playerId=Name&season=2024')})).status,400);
});

test('automatic balls retain terminal walk evidence but never inflate pitched-ball denominators or arsenal usage',()=>{
 const lab=buildMlbStatcastLab([packet([row(),row({at_bat_number:2,pitch_number:2,description:'automatic_ball',events:'intent_walk',pitch_type:'',type:'B',zone:null,plate_x:null,plate_z:null})])],{season:2024});assert.equal(lab.pitches,1);assert.equal(lab.plateAppearances,2);assert.equal(lab.metrics.walk.value,.5);assert.equal(lab.metrics.swstr.value,1);assert.equal(lab.arsenal.length,1);assert.equal(lab.handedness[0].pitches,1);assert.equal(lab.coverage.automaticEvents,1);
});

test('concurrent identical imports create a single immutable snapshot and reuse the first committed evidence',async()=>{
 const ARCHIVE=bucket(),payload={playerId:'669373',role:'pitcher',season:2024,cutoffDay:'2026-10-24',rawCsv:csv([row()]),finalGameIds:['1'],sourceUrl:'https://baseballsavant.mlb.com/statcast_search/csv?player_type=pitcher&pitchers_lookup[]=669373'};
 const results=await Promise.all([persistLabPacket({ARCHIVE},payload),persistLabPacket({ARCHIVE},payload)]);assert.equal(results.filter(r=>r.reused).length,1);assert.equal(ARCHIVE.map.size,3);assert.equal((await readLabPackets({ARCHIVE},{playerId:'669373',role:'pitcher',seasons:[2024]})).packets.length,1);
});

test('truncated PAs and baserunner-only events never inflate completed-PA K/BB denominators',()=>{
 const lab=buildMlbStatcastLab([packet([row(),row({at_bat_number:2,events:'truncated_pa',description:'ball',type:'B'}),row({at_bat_number:3,events:'caught_stealing_2b',description:'ball',type:'B'})])],{season:2024});assert.equal(lab.pitches,3);assert.equal(lab.plateAppearances,1);assert.equal(lab.metrics.strikeout.value,1);assert.equal(lab.calculationVersion,'mlb-lab-metrics-v1.1');
});
