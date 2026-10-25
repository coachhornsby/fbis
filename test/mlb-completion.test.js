import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMlbAblationFreeze,persistMlbAblationFreeze,archiveMlbFinalGame,gradeMlbAblations,summarizeMlbAblations} from '../functions/lib/mlbCompletionEvidence.js';
const now='2026-10-24T15:00:00Z';
const game=()=>({id:'1',start:'2026-10-25T00:00:00Z',homeSp:{id:11},awaySp:{id:22},home:{abbr:'A'},away:{abbr:'B'},savant:{homeRpg:4,awayRpg:4,homeSpEra:3,awaySpEra:4,homeSpKPer9:9,awaySpKPer9:9,homeSpInningsPerStart:5,awaySpInningsPerStart:5},mlbContext:{postseason:true,palParkRunFactor:1.1,palParkHrFactor:1.2,homePalRcVsTypical:.1,awayPalRcVsTypical:.2}});
const feed=()=>({gameData:{game:{pk:1,type:'W',season:2026},datetime:{officialDate:'2026-10-24',dateTime:'2026-10-25T00:00:00Z'},status:{abstractGameState:'Final',codedGameState:'F'}},liveData:{boxscore:{teams:{home:{team:{id:1},pitchers:[11],players:{ID11:{person:{id:11},stats:{pitching:{inningsPitched:'5.0',battersFaced:20,strikeOuts:0}}}}},away:{team:{id:2},pitchers:[22],players:{ID22:{person:{id:22},stats:{pitching:{inningsPitched:'6.0',battersFaced:24,strikeOuts:6}}}}}}},linescore:{teams:{home:{runs:0},away:{runs:3}}},plays:{allPlays:[]}}});
function archive(){const objects=new Map();return {objects,get:async key=>{const value=objects.get(key);if(value==null)return null;return {json:async()=>JSON.parse(value),body:new Blob([value]).stream()};},put:async(key,value,options)=>{if(options?.onlyIf&&objects.has(key))return null;objects.set(key,value);return{};}};}
test('freezes all four variants without market quotes and rejects after-start inputs',()=>{
 const f=buildMlbAblationFreeze(game(),now);assert.deepEqual(Object.keys(f.predictions),['baseline','statcast','pal','combined']);assert.equal(f.classification,'PROSPECTIVE');assert.equal(f.canPromote,false);
 assert.notEqual(f.predictions.baseline.total,f.predictions.pal.total);
 assert.throws(()=>buildMlbAblationFreeze(game(),'2026-10-25T01:00:00Z'));
});
test('first checkpoint forecast survives retries unchanged',async()=>{
 const env={ARCHIVE:archive()},a=await persistMlbAblationFreeze(env,game(),'2026-10-24',now),g=game();g.savant.homeRpg=9;
 const b=await persistMlbAblationFreeze(env,g,'2026-10-24','2026-10-24T16:00:00Z');assert.equal(b.reused,true);assert.equal(a.sourceHash,b.sourceHash);assert.equal(a.capturedAt,b.capturedAt);
});
test('official final grading preserves zero strikeouts, rejects identity changes and does not invent DNP outcomes',()=>{
 const f=buildMlbAblationFreeze(game(),now),final=feed(),grade=gradeMlbAblations(f,final);assert.equal(grade.targets.find(t=>t.playerId==='11').actual,0);
 final.liveData.boxscore.teams.home.pitchers=[99];const missing=gradeMlbAblations(f,final);assert.equal(missing.missingPitcherTargets,1);
 final.gameData.game.pk=2;assert.throws(()=>gradeMlbAblations(f,final));assert.throws(()=>gradeMlbAblations({...f,sourceHash:'bad'},feed()));
});
test('source retries preserve immutable game versions and keep bulk history out of D1',async()=>{
 const env={ARCHIVE:archive()},a=await archiveMlbFinalGame(env,feed(),now),b=await archiveMlbFinalGame(env,feed(),'2026-10-25T12:00:00Z');
 assert.equal(a.sourceHash,b.sourceHash);assert.equal(a.observedAt,b.observedAt);assert.equal(b.reused,true);assert.equal(b.indexedInD1,false);
});
test('score cohorts separate checkpoints and count distinct games instead of treating variants as games',()=>{
 const grade=gradeMlbAblations(buildMlbAblationFreeze(game(),now),feed()),report=summarizeMlbAblations([grade]);
 const k=report.cohorts.find(c=>c.cohort.includes('pitcher_strikeouts'));assert.equal(k.n,2);assert.equal(k.distinctGames,1);assert.equal(report.canPromote,false);assert.equal(report.profitability,null);assert.throws(()=>summarizeMlbAblations([grade,grade]));
});

test('future source timestamps reject before freezing; operator route requires auth',async()=>{
 const g=game();g.mlbContext.palAsOf='2026-10-24T16:00:00Z';assert.throws(()=>buildMlbAblationFreeze(g,now));
 const {onRequestPost}=await import('../functions/api/mlb-completion.js');const r=await onRequestPost({env:{},request:new Request('https://fbis-myz.pages.dev/api/mlb-completion',{method:'POST',body:'{}'})});assert.equal(r.status,403);
});

test('production hitter forecasts freeze without quotes and preserve real zeroes while excluding DNPs',()=>{
 const g=game();g.playerProjectionRows=[{playerId:'99',position:'DH',market:'hits',fbisProjection:1.2,modelVersion:'hitter-v1'}];const f=buildMlbAblationFreeze(g,now),result=feed();
 result.liveData.boxscore.teams.home.players.ID99={person:{id:99},stats:{batting:{plateAppearances:4,hits:0,doubles:0,triples:0,homeRuns:0}}};
 let graded=gradeMlbAblations(f,result);assert.equal(graded.productionPlayerTargets[0].actual,0);assert.equal(graded.productionPlayerTargets[0].projection,1.2);
 result.liveData.boxscore.teams.home.players.ID99.stats.batting.plateAppearances=0;graded=gradeMlbAblations(f,result);assert.equal(graded.productionPlayerTargets.length,0);
});

test('training-day reads immutable games in bounded batches, preserves receipt order and fails on missing source',async()=>{
 const {onRequestPost}=await import('../functions/api/mlb-completion.js'),{gzipEvidence}=await import('../functions/lib/mlbCompletionEvidence.js'),date='2024-05-01';
 const receipts=Array.from({length:9},(_,i)=>({key:'game/'+i})),data=await Promise.all(receipts.map((_,i)=>gzipEvidence({gameId:String(i),officialDate:date,gameType:'R',sourceHash:'hash'+i,players:[]})));
 let active=0,peak=0,missing=false;
 const archive={put:async()=>{},get:async key=>{
  if(key.includes('/manifests/'))return {json:async()=>({complete:true,receipts})};
  if(key.includes('/current.json'))return {json:async()=>({key:'league'})};
  if(key==='league')return {json:async()=>({complete:true,sourceHash:'leaguehash',pitcherDays:[],batterDays:[]})};
  if(key.startsWith('game/')){active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;if(missing&&key==='game/4')return null;return {body:new Blob([data[Number(key.slice(5))]]).stream()};}return null;
 }};
 const call=()=>onRequestPost({env:{ARCHIVE:archive,HARVEST_SECRET:'fixture'},request:new Request('https://example.com/api/mlb-completion',{method:'POST',headers:{'x-harvest-secret':'fixture'},body:JSON.stringify({date,operation:'training-day'})})});
 const r=await call(),body=await r.json();assert.equal(r.status,200);assert.deepEqual(body.games.map(g=>g.gameId),receipts.map((_,i)=>String(i)));assert.equal(peak,4);
 missing=true;const failed=await call();assert.equal(failed.status,422);assert.equal((await failed.json()).error,'GAME_SOURCE_MISSING');
});

test('immutable MLB ablation freeze rejects nested bulletin and lineup receipts obtained after the capture',()=>{
 const g=game();
 g.mlbContext.bullpenEvidence={sources:[{observedAt:'2026-10-24T16:00:00Z'}]};
 assert.throws(()=>buildMlbAblationFreeze(g,now),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
 g.mlbContext.bullpenEvidence.sources[0].observedAt='2026-10-24T14:00:00Z';
 g.playerProjectionRows=[{playerId:'99',position:'DH',market:'hits',fbisProjection:1.2,
  lineage:{acquisition_timestamp:'2026-10-24T15:01:00Z'}}];
 assert.throws(()=>buildMlbAblationFreeze(g,now),/MLB_PIT_SOURCE_AFTER_CHECKPOINT/);
 g.playerProjectionRows[0].lineage.acquisition_timestamp='2026-10-24T14:59:00Z';
 assert.equal(buildMlbAblationFreeze(g,now).classification,'PROSPECTIVE');
});
