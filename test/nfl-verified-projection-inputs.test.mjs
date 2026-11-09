import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import teams from '../data/teams/nfl.js';
import {projectVerifiedNflFutureGames,validateVerifiedNflInput} from '../functions/lib/nflVerifiedProjectionInputs.js';
const now=Date.parse('2026-11-08T23:40:00Z'),at='2026-11-08T23:30:00Z';
const clone=structuredClone;
function fixture(){
 const codes=teams.map(t=>t.abbr),scheduleGames=[],rot=[...codes];
 for(let week=1;week<=17;week++){
  for(let k=0;k<16;k++){
   const home=rot[k],away=rot[31-k],i=scheduleGames.length;
   scheduleGames.push({id:`2026_${String(week).padStart(2,'0')}_${away}_${home}`,espnId:String(1000+i),week,home,away,start:new Date(Date.parse('2026-09-10T20:00:00Z')+(week-1)*7*86400000).toISOString(),neutralSite:false});
  }
  rot.splice(1,0,rot.pop());
 }
 const schedule={season:2026,observedAt:at,source:'https://github.com/nflverse/nfldata/raw/refs/heads/master/data/games.csv',games:scheduleGames};
 const target=scheduleGames.find(g=>g.week===10),home=teams.find(t=>t.abbr===target.home),away=teams.find(t=>t.abbr===target.away);
 const game={id:target.espnId,sport:'nfl',start:target.start,status:'scheduled',neutralSite:false,home,away,model:{projHome:20,projAway:20}};
 const root='https://github.com/nflverse/nflverse-data/releases/download/';
 const sourceObservations=[...['passing','rushing','receiving'].map(x=>root+`nextgen_stats/ngs_${x}.csv.gz`),...[2026,2025].flatMap(y=>[root+`stats_team/stats_team_week_${y}.csv`,root+`stats_player/stats_player_week_${y}.csv`,root+`snap_counts/snap_counts_${y}.csv`]),root+'pbp/play_by_play_2026.csv.gz'].map(url=>({url,status:200,observedAt:at,lastModified:'Sun, 08 Nov 2026 22:00:00 GMT'}));
 const fields={offenseEpa:.2,defenseEpa:-.1,passEpa:.2,passEpaAllowed:-.1,rushEpa:.1,rushEpaAllowed:0,qbEpa:.2,qbCpoe:2,successRate:.45,successRateAllowed:.4,earlyDownEpa:.1,earlyDownEpaAllowed:0,explosiveRate:.12,explosiveRateAllowed:.1};
 const snapshot={season:2026,byTeam:Object.fromEntries(codes.map((t,i)=>[t,{...fields,offenseEpa:.05+i*.005}])),playersByTeam:Object.fromEntries(codes.map(t=>[t,[{id:'player-'+t,name:'Player '+t,position:'QB',team:t,games:8,passing_yards:250,attempts:32,completions:20,snapShare:.95,recent5:{games:5},recentGames:[{season:2026,week:9,opponent:(()=>{const g=scheduleGames.find(g=>g.week===9&&[g.home,g.away].includes(t));return g.home===t?g.away:g.home;})()}]}]])),meta:{builtAt:'2026-11-08T23:20:00Z',marketInformed:false,currentRows:{team:288},sourceObservations}};
 const receipt={sport:'nfl',source:'nflverse',season:2026,observedAt:at,dataThrough:'2026-11-08T22:00:00Z',sourceObservations,completedWeek:9,completedGameIds:scheduleGames.filter(g=>g.week<=9).map(g=>g.id)};
 const publication={schema:'nfl-feature-publication-v1',snapshotText:JSON.stringify(snapshot),receipt};
 const input={games:[game],publication,schedule,now};seal(input);return input;
}
function seal(i){i.publication.receipt.snapshotSha256=createHash('sha256').update(i.publication.snapshotText).digest('hex');}
test('actual score and player consumers run for verified future NFL only without authority',async()=>{const i=fixture(),before=clone(i.games);const r=await projectVerifiedNflFutureGames(i);assert.equal(r.meta.applied,1);assert.notEqual(r.games[0].model.projHome,20);assert.ok(r.games[0].playerProjectionRows.length);assert.equal(r.games[0].model.canQualify,false);assert.ok(r.games[0].playerProjectionRows.every(p=>p.canAuthorizeWager===false&&p.propGate==='HOLD'));assert.deepEqual(i.games,before);});
test('started, final, unknown status and college fixtures remain byte-for-byte unchanged',async()=>{for(const change of [{status:'live'},{status:'final'},{status:'unknown'},{sport:'cfb'},{sport:'cbb'},{start:new Date(now).toISOString()}]){const i=fixture();Object.assign(i.games[0],change);const r=await projectVerifiedNflFutureGames(i);assert.strictEqual(r.games[0],i.games[0]);assert.equal(r.meta.applied,0);}});
test('cross-team, wrong start and unknown neutral-site fixtures cannot attach',async()=>{for(const mutate of [g=>g.home.espnId='999',g=>g.start='2026-12-01T00:00:00Z',g=>g.neutralSite=null,g=>g.home.abbr=g.away.abbr]){const i=fixture();i.games=clone(i.games);mutate(i.games[0]);const r=await projectVerifiedNflFutureGames(i);assert.equal(r.meta.applied,0);assert.equal(r.decisions[0].reason,'FIXTURE_IDENTITY_UNVERIFIED');}});
test('missing/hash-tampered/old receipts preserve existing forecast fallback',async()=>{for(const mutate of [i=>i.publication=null,i=>i.publication.receipt.snapshotSha256='bad',i=>i.publication.receipt.observedAt='2026-11-01T23:30:00Z',i=>i.publication.receipt.sourceObservations[0].lastModified='Sun, 01 Nov 2026 22:00:00 GMT']){const i=fixture();mutate(i);const r=await projectVerifiedNflFutureGames(i);assert.strictEqual(r.games[0],i.games[0]);assert.equal(r.meta.applied,0);}});
test('partial latest week blocks only teams lacking prior-game evidence',async()=>{const i=fixture(),target=i.schedule.games.find(g=>g.espnId===i.games[0].id),prior=i.schedule.games.find(g=>g.week===9&&[g.home,g.away].includes(target.home));i.publication.receipt.completedGameIds=i.publication.receipt.completedGameIds.filter(id=>id!==prior.id);i.publication.receipt.completedWeek=8;const p=JSON.parse(i.publication.snapshotText);p.meta.currentRows.team-=2;for(const t of [prior.home,prior.away]){const g=i.schedule.games.find(g=>g.week===8&&[g.home,g.away].includes(t));p.playersByTeam[t][0].recentGames=[{season:2026,week:8,opponent:g.home===t?g.away:g.home}];}i.publication.snapshotText=JSON.stringify(p);seal(i);const r=await projectVerifiedNflFutureGames(i);assert.equal(r.decisions[0].reason,'PRIOR_TEAM_GAME_NOT_IN_SOURCE');});
test('schedule omissions, duplicate weeks and source field gaps fail closed',async()=>{for(const mutate of [i=>i.schedule.games.pop(),i=>i.schedule.games[0].week=2,i=>{const p=JSON.parse(i.publication.snapshotText);delete p.byTeam.ARI.qbEpa;i.publication.snapshotText=JSON.stringify(p);seal(i);}]){const i=fixture();mutate(i);await assert.rejects(()=>validateVerifiedNflInput({...i.publication,schedule:i.schedule,now}));}});
test('unknown completed game, false completedWeek and source-count mismatch fail closed',async()=>{for(const mutate of [i=>i.publication.receipt.completedGameIds[0]='2026_01_FAKE_FAKE',i=>i.publication.receipt.completedWeek=10,i=>{const p=JSON.parse(i.publication.snapshotText);p.meta.currentRows.team=999;i.publication.snapshotText=JSON.stringify(p);seal(i);}]){const i=fixture();mutate(i);const r=await projectVerifiedNflFutureGames(i);assert.equal(r.meta.applied,0);}});

test('completed-game future leakage and malformed player rows fail into unchanged fallback',async()=>{for(const mutate of [i=>i.schedule.games[0].start='2026-11-09T00:00:00Z',i=>{const p=JSON.parse(i.publication.snapshotText);p.playersByTeam.ARI=[null];i.publication.snapshotText=JSON.stringify(p);seal(i);},i=>{const p=JSON.parse(i.publication.snapshotText);p.playersByTeam.ARI[0].team='BUF';i.publication.snapshotText=JSON.stringify(p);seal(i);}]){const i=fixture();mutate(i);const r=await projectVerifiedNflFutureGames(i);assert.strictEqual(r.games[0],i.games[0]);assert.equal(r.meta.applied,0);}});

test('inherited authority flags cannot survive research recomputation',async()=>{const i=fixture();Object.assign(i.games[0],{canAuthorize:true,decisionEligible:true});i.games[0].model.canAuthorizeWager=true;const r=await projectVerifiedNflFutureGames(i),g=r.games[0];assert.equal(r.meta.applied,1);assert.equal(g.canAuthorize,false);assert.equal(g.decisionEligible,false);assert.equal(g.model.canAuthorizeWager,false);assert.equal(g.playerProjectionStatus.state,'HOLD_VALIDATION');});
test('prior-season-only player history is excluded without suppressing valid game forecast',async()=>{const i=fixture(),p=JSON.parse(i.publication.snapshotText),home=i.games[0].home.abbr;p.playersByTeam[home][0].recentGames[0].season=2025;i.publication.snapshotText=JSON.stringify(p);seal(i);const r=await projectVerifiedNflFutureGames(i);assert.equal(r.meta.applied,1);assert.equal(r.games[0].playerProjectionRows.some(row=>row.team===home),false);assert.equal(r.games[0].nflVerifiedInput.excludedPriorOnlyPlayers,1);});

test('malformed nested stats and duplicate recent games preserve existing forecast',async()=>{for(const mutate of [p=>p.playersByTeam.ARI[0].recent5.passing_yards=-9999,p=>p.playersByTeam.ARI[0].seasonAvg={attempts:'twenty'},p=>p.playersByTeam.ARI[0].recentGames.push(p.playersByTeam.ARI[0].recentGames[0])]){const i=fixture(),p=JSON.parse(i.publication.snapshotText);mutate(p);i.publication.snapshotText=JSON.stringify(p);seal(i);const r=await projectVerifiedNflFutureGames(i);assert.equal(r.meta.applied,0);assert.strictEqual(r.games[0],i.games[0]);}});

import {prepareVerifiedNflRecoveryPacket} from '../functions/lib/nflVerifiedRecoveryPacket.js';
import {publicProjectionSummary,validatePublicProjectionSummary} from '../functions/lib/publicFourSportProjection.js';
import {onRequestGet as publicSportGet} from '../deploy/board/functions/api/public/sports/[sport]/[date].js';
import {privateFourSportProjectionFor} from '../functions/lib/privateFourSportProjection.js';
test('recovery packet reaches public card contract and preserves already-started score bytes',async()=>{
 const i=fixture(),date='2026-11-08',g=i.games[0];g.date=date;g.start='2026-11-08T23:50:00Z';i.schedule.games.find(x=>x.espnId===g.id).start=g.start;
 const old={eventId:'9991',date,start:'2026-11-08T19:00:00Z',homeId:'nfl-1',awayId:'nfl-2',sourceCapturedAt:'2026-11-08T17:50:00Z',canAuthorizeWager:false,projection:{homeScore:21,awayScore:20,margin:1,total:41,modelId:'NFL-TEAM-FORM-v0',modelVersion:'v0'},sourceLabel:'ESPN verified 2026 final scores; baseline'};
 const previousPacket={version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',sport:'nfl',date,generatedAt:'2026-11-08T18:00:00Z',expiresAt:'2026-11-09T02:00:00Z',modelAuthority:'RESEARCH_ONLY',canAuthorizeWager:false,events:[old]};
 const result=await prepareVerifiedNflRecoveryPacket({...i,date,previousPacket});assert.strictEqual(result.packet.events[0],old);assert.equal(result.packet.eventGeneratedAt['9991'],previousPacket.generatedAt);assert.equal(Date.parse(result.packet.expiresAt),Date.parse(previousPacket.expiresAt));
 const publicPacket=publicProjectionSummary(result.packet,{sport:'nfl',date});validatePublicProjectionSummary(publicPacket,{sport:'nfl',date});assert.equal(publicPacket.events.length,2);assert.equal(privateFourSportProjectionFor(g,publicPacket,now).projection.modelId,'NFL-PRO-v1');assert.ok(!JSON.stringify(publicPacket).includes('snapshotSha256'));assert.equal(publicPacket.canQualify,false);
 const raw=JSON.stringify(result.packet),reads=[];const originalNow=Date.now;Date.now=()=>now;let response;try{response=await publicSportGet({params:{sport:'nfl',date},env:{FBIS_PRIVATE_CBB:{get:async key=>{reads.push(key);return {size:raw.length,text:async()=>raw};}}}});}finally{Date.now=originalNow;}assert.equal(response.status,200);const served=(await response.json()).packet;validatePublicProjectionSummary(served,{sport:'nfl',date});assert.equal(privateFourSportProjectionFor(g,served,now).projection.homeScore,result.packet.events[1].projection.homeScore);assert.deepEqual(reads,['private/nfl/projections/'+date+'.json']);
 const playerRows=privateFourSportProjectionFor(g,served,now).nflPlayerResearch.rows;assert.ok(playerRows.length>0);assert.deepEqual(playerRows,result.packet.events[1].nflPlayerResearch.rows);assert.ok(playerRows.every(r=>r.gate==='HOLD'));assert.ok(!JSON.stringify(playerRows).includes('availabilityPreflight'));
 for(const mutate of [p=>p.rows[0].gate='CLEAR',p=>p.rows[0].teamId='nfl-999',p=>p.rows[0].projection=Infinity,p=>p.rows[0].sourcePayload={},p=>p.rows.push(p.rows[0])]){const bad=structuredClone(served);mutate(bad.events[1].nflPlayerResearch);assert.throws(()=>validatePublicProjectionSummary(bad,{sport:'nfl',date}),/INVALID_NFL_PLAYER/);}
});
test('recovery packet never restamps an expired predecessor',async()=>{const i=fixture(),date='2026-11-08';const previousPacket={version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',sport:'nfl',date,generatedAt:'2026-11-08T18:00:00Z',expiresAt:'2026-11-08T19:00:00Z',modelAuthority:'RESEARCH_ONLY',canAuthorizeWager:false,events:[]};await assert.rejects(()=>prepareVerifiedNflRecoveryPacket({...i,date,previousPacket}),/EXPIRED_NO_RESTAMP/);});

import {overlayVerifiedResearchScores} from '../src/lib/productionRecoveryOverlay.js';
test('verified EPA produces all four real directional rows through public summary and board overlay',async()=>{
 const i=fixture(),date='2026-11-08',g=i.games[0];g.date=date;g.start='2026-11-08T23:50:00Z';i.schedule.games.find(x=>x.espnId===g.id).start=g.start;
 const result=await prepareVerifiedNflRecoveryPacket({...i,date});
 const packet=publicProjectionSummary(result.packet,{sport:'nfl',date});validatePublicProjectionSummary(packet,{sport:'nfl',date});
 const shown=overlayVerifiedResearchScores(g,{sportPacket:packet,clock:now});
 assert.equal(shown.nflGameMatchup.unitMatchups.length,4);assert.ok(shown.nflGameMatchup.unitMatchups.every(r=>r.available&&Number.isFinite(r.offenseEpa)&&r.metric==='EPA per play'));
 assert.equal(shown.canAuthorizeWager,false);assert.equal(shown.model.id,'NFL-PRO-v1');
 for(const mutate of [r=>r.adjustment=99,r=>r.offenseEpa=null,r=>r.winner='FAKE',r=>r.sourcePayload={}]){const bad=clone(packet);mutate(bad.events[0].nflDirectionalResearch.unitMatchups[0]);assert.throws(()=>validatePublicProjectionSummary(bad,{sport:'nfl',date}),/NFL_DIRECTIONAL/);}
});
test('missing defense EPA prevents advanced consumer from manufacturing directional statistics',async()=>{
 const i=fixture(),p=JSON.parse(i.publication.snapshotText);delete p.byTeam.ARI.rushEpaAllowed;i.publication.snapshotText=JSON.stringify(p);seal(i);
 const r=await projectVerifiedNflFutureGames(i);assert.equal(r.meta.applied,0);assert.equal(r.decisions[0].reason,'NFL_FEATURE_COVERAGE');
});
