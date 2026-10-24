import test from 'node:test';
import assert from 'node:assert/strict';
import {mlbEnvironment} from '../functions/lib/mlbEnvironment.js';
import {archiveProjectionProfile,archiveLineupMatchup,withArchivePlayerProfiles} from '../functions/lib/mlbArchiveProjection.js';
import {sha256Hex} from '../functions/lib/sha256Hex.js';
const now='2026-10-24T12:00:00Z',gameStart='2026-10-24T23:00:00Z';
const rows=Array.from({length:240},(_,i)=>({pitcher:'1',batter:'2',game_date:'2026-10-23',game_type:'R',game_pk:'9',at_bat_number:String(Math.floor(i/4)),pitch_number:String(i%4+1),pitch_type:'FF',description:i%4===3?'swinging_strike':'called_strike',events:i%4===3?'strikeout':'',type:'S',stand:'L',p_throws:'R',plate_x:0,plate_z:2.5,sz_bot:1.5,sz_top:3.5}));
const packet=(rs=rows)=>({playerId:'1',role:'pitcher',season:2026,observedAt:'2026-10-24T10:00:00Z',sourceHash:sha256Hex(JSON.stringify(rs)),rows:rs});
const profile=packets=>archiveProjectionProfile({packets,playerId:'1',role:'pitcher',gameStart,now});
test('Pal daily weather is applied once; explicitly stadium-only input retains separate weather',()=>{
 const a=mlbEnvironment({palParkRunFactor:1.1,weatherRunFactor:1.2});assert.equal(a.runFactor,1.1);assert.equal(a.weatherIncludedInPal,true);
 const b=mlbEnvironment({palParkRunFactor:1.1,palParkIncludesWeather:false,weatherRunFactor:.9});assert.ok(Math.abs(b.runFactor-.99)<1e-12);
 assert.equal(mlbEnvironment({weatherRunFactor:1.1}).runFactor,1.1);
 assert.equal(mlbEnvironment({palParkRunFactor:null,weatherRunFactor:1.1}).weatherIncludedInPal,false);
});
test('archive profile retains completed PA counts and rejects post-start, stale or thin samples',()=>{
 const p=profile([packet()]);assert.equal(p.plateAppearances,60);assert.equal(p.featureEvidence.pitches,240);
 assert.equal(archiveProjectionProfile({packets:[packet()],playerId:'1',role:'pitcher',gameStart:now,now}),null);
 assert.equal(profile([{...packet(),observedAt:'2026-10-20T10:00:00Z'}]),null);
 assert.equal(profile([packet(rows.slice(0,20))]),null);
 assert.throws(()=>profile([{...packet(),sourceHash:'wrong'}]));
});
test('archive matchup requires every expected batter; does not silently use a partial lineup',()=>{
 const p=profile([packet()]);assert.equal(archiveLineupMatchup({pitcherProfile:p,batterProfiles:[p],pitcherId:1,batterIds:[2,3,4,5,6]}),null);
});
test('prop overlay preserves official workload and never mutates the persistent state',()=>{
 const state={fresh:true,homeStarter:{expectedInnings:5},hitters:{'2':{name:'B',hitPerPa:.25}},teamHitters:{away:{'2':{name:'B'}}}};
 const p=profile([packet()]),out=withArchivePlayerProfiles({byGameId:{g:state}},{g:{home:{pitcherProfile:p,batterProfiles:[p],matchup:{batterIds:[2]}}}});
 assert.equal(out.byGameId.g.homeStarter.expectedInnings,5);assert.equal(out.byGameId.g.hitters['2'].hitPerPa,.25);
 assert.equal(state.homeStarter.statcastProfile,undefined);assert.equal(out.byGameId.g.hitters['2'].statcastProfile,p);
});

test('production loader reads verified R2 archives, scores the correct offense and never calls upstream',async()=>{
 const {loadMlbPitchMatchupContext}=await import('../functions/lib/mlbPitchMatchupFeed.js');
 const {MLB_STATCAST_LAB_VERSION}=await import('../functions/lib/mlbStatcastLab.js');
 const objects=new Map();
 for(const [id,role] of [[1,'pitcher'],...[2,3,4,5,6].map(id=>[id,'batter'])])for(const season of [2025,2026]){
  const rs=season===2026?rows.map(r=>({...r,[role]:String(id)})):[];
  const p={...packet(rs),version:MLB_STATCAST_LAB_VERSION,playerId:String(id),role,season};
  const key=`sample-${id}-${role}-${season}`;
  objects.set(`models/mlb/player-lab/v1/${role}/${id}/${season}/current.json`,{key});
  objects.set(key,await new Response(new Blob([JSON.stringify(p)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 }
 const env={DB:{prepare(){}},ARCHIVE:{get:async key=>{const v=objects.get(key);if(!v)return null;return v instanceof ArrayBuffer?{body:new Blob([v]).stream()}:{json:async()=>v};}}};
 const game={id:'g',sport:'mlb',start:gameStart,homeSp:{id:1},awaySp:{id:999},bpp:{batterMatchups:[2,3,4,5,6].map(batterId=>({pitcherId:1,batterId}))}};
 const result=await loadMlbPitchMatchupContext([game],env,{now,persistentState:{byGameId:{},meta:{configured:true}},fetchFn:()=>{throw Error('UPSTREAM_FORBIDDEN');}});
 assert.equal(result.meta.archiveAvailable,1);
 assert.equal(result.byGameId.g.awayOffense.pitcherId,1);
 assert.equal(result.byGameId.g.awayOffense.source,'MLB_VERIFIED_ARCHIVE_STATCAST');
 assert.equal(result.byGameId.g.homeOffense,null);
 assert.equal(result.meta.liveFallbacks,0);
});
