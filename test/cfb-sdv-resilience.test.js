import test from 'node:test';import assert from 'node:assert/strict';
import {fetchWithCfbBackoff,retryAfterUntil} from '../functions/lib/cfbProviderBackoff.js';
import {resetCacheMem} from '../functions/lib/cache.js';
import {parseCsv,buildSdvIntelligence,nullableNumber,attachSdvResults} from '../functions/lib/cfbSdvIntelligence.js';
import {buildSdvFeatureSnapshot} from '../functions/lib/cfbSdvFeatureSnapshot.js';
import {loadCfbPublicWeek} from '../functions/lib/cfbPublicSchedule.js';
const csv='team_id,pos_team,division,conference,season,valid_games,plays_off,adj_off_epa,adj_def_epa,net_adj_epa,success_off\n333,Alabama,fbs,SEC,2026,4,250,0.3,0.1,0.2,\n61,Georgia,fbs,SEC,2026,4,200,0.2,0.1,0.1,0.4\n';
test('Retry-After delta and HTTP date are respected; cross-endpoint calls pause after 429',async()=>{
 resetCacheMem();let calls=0;
 assert.equal(retryAfterUntil('120',1000),121000);assert.equal(retryAfterUntil('Sun, 11 Oct 2026 06:00:00 GMT',Date.parse('2026-10-11T05:00Z')),Date.parse('2026-10-11T06:00Z'));
 const fn=async()=>{calls++;return Response.json({}, {status:429,headers:{'Retry-After':'600'}});};
 await fetchWithCfbBackoff('https://api.collegefootballdata.com/games',{}, {},fn);
 const blocked=await fetchWithCfbBackoff('https://api.collegefootballdata.com/ppa/teams',{}, {},fn);
 assert.equal(calls,1);assert.equal(blocked.headers.get('X-FBIS-Cooldown'),'true');
 const basketballBlocked=await fetchWithCfbBackoff('https://api.collegebasketballdata.com/games',{}, {},fn);assert.equal(calls,1);assert.equal(basketballBlocked.headers.get('X-FBIS-Cooldown'),'true');resetCacheMem();
});
test('concurrent same-URL provider reads share one request with independent bodies',async()=>{
 resetCacheMem();let calls=0;const fn=async()=>{calls++;await new Promise(r=>setTimeout(r,5));return Response.json([1]);};
 const responses=await Promise.all([fetchWithCfbBackoff('https://api.collegefootballdata.com/games',{}, {},fn),fetchWithCfbBackoff('https://api.collegefootballdata.com/games',{}, {},fn)]);
 assert.equal(calls,1);assert.deepEqual(await responses[0].json(),[1]);assert.deepEqual(await responses[1].json(),[1]);
});
test('CSV handles quoted commas, multiline values and missing numbers without zero filling',()=>{
 assert.equal(parseCsv('a,b\n"one, two","three\nfour"\n').rows[0].b,'three\nfour');assert.equal(nullableNumber('NA'),null);assert.equal(nullableNumber(''),null);assert.equal(nullableNumber('0'),0);assert.throws(()=>parseCsv('a,b\n1\n'));
});
test('team and conference ratings retain samples, correct defense orientation and nulls',()=>{
 const d=buildSdvIntelligence(csv);assert.equal(d.teams.length,2);assert.equal(d.teams[0].rank,1);assert.equal(d.teams[0].defenseRank,1);assert.equal(d.teams[1].defenseRank,1);
 assert.equal(d.teams[0].stats.success_off,null);assert.equal(d.conferences[0].metrics.net_adj_epa.teams,2);assert.ok(Math.abs(d.conferences[0].metrics.net_adj_epa.value-70/450)<1e-12);assert.equal(d.model.allStatsConsumed,false);
 assert.throws(()=>buildSdvIntelligence(csv+csv.split('\n')[1]+'\n'));
});
test('records include non-FBS opponents, require final status, and expose summary lag',()=>{
 const d=buildSdvIntelligence(csv);const rows='game_id,season,status,home_id,away_id,home_score,away_score,home_team,away_team,game_date\n1,2026,STATUS_FINAL,333,999999,20,10,Alabama,Non-FBS,2026-09-01\n2,2026,STATUS_IN_PROGRESS,333,61,0,0,Alabama,Georgia,2026-10-11\n';
 attachSdvResults(d,rows);assert.equal(d.teams[0].record.wins,1);assert.equal(d.teams[0].record.sourceFinalGames,1);
});
test('all-stat research snapshots enforce source/decision/kickoff times and frozen team orientation',()=>{
 const d=buildSdvIntelligence(csv,{sha256:'a'.repeat(64),observedAt:'2026-10-11T04:00Z'}),game={id:'g',start:'2026-10-12T19:00Z',home:{espnId:'333'},away:{espnId:'61'}};
 const s=buildSdvFeatureSnapshot(d,game,'2026-10-11T05:00Z','2026-10-11T05:01Z');assert.equal(s.sides.home.teamId,'cfb:espn:333');assert.equal(s.sides.home.candidateFeatures.success_off,null);assert.equal(s.canAuthorizeWager,false);
 assert.throws(()=>buildSdvFeatureSnapshot(d,game,'2026-10-11T03:00Z','2026-10-11T05:01Z'));assert.throws(()=>buildSdvFeatureSnapshot(d,game,'2026-10-13T03:00Z','2026-10-13T05:01Z'));
});
test('public weekly schedule is bounded and cached, includes FBS-only verified participants',async()=>{
 resetCacheMem();let calls=0;const event={id:'1',date:'2026-10-17T19:00Z',season:{year:2026},competitions:[{competitors:[{homeAway:'home',team:{id:'333',displayName:'Alabama'}},{homeAway:'away',team:{id:'61',displayName:'Georgia'}}]}]};
 const fn=async url=>{calls++;assert.match(url,/groups=80/);assert.match(url,/dates=2026101[1-7]/);return Response.json({events:[event,{...event,id:'2',competitions:[{competitors:[{homeAway:'home',team:{id:'333'}},{homeAway:'away',team:{id:'999999'}}]}]}]});};
 const d=await loadCfbPublicWeek('2026-10-11',{},0,fn);assert.equal(d.games.length,1);await loadCfbPublicWeek('2026-10-11',{},0,fn);assert.equal(calls,7);resetCacheMem();
});
