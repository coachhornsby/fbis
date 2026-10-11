import test from 'node:test';import assert from 'node:assert/strict';
import {buildSdvIntelligence,attachSdvResults} from '../functions/lib/cfbSdvIntelligence.js';
import {reconcileCfbWindow} from '../scripts/cfb-production-acceptance.mjs';
const csv='team_id,pos_team,division,conference,season,valid_games,plays_off,plays_def,adj_off_epa,adj_def_epa,net_adj_epa,EPAplay_off_pass,EPAplay_def_pass,line_yards_off_rush\n333,Alabama,fbs,SEC,2026,4,200,300,0.3,0.1,0.2,0.4,0.2,3.1\n61,Georgia,fbs,SEC,2026,4,500,100,0.2,0.05,0.15,0.3,0.1,3.1\n99,LSU,fbs,OTHER,2026,4,200,300,0.1,0.2,-0.1,,0.3,2.4\n';
test('category ranks preserve direction, ties, missing values, depth and no authority',()=>{
 const d=buildSdvIntelligence(csv);const a=d.teams.find(t=>t.espnId==='333'),g=d.teams.find(t=>t.espnId==='61'),l=d.teams.find(t=>t.espnId==='99');
 assert.equal(g.rankings.passingDefense.rank,1);assert.equal(a.rankings.passingDefense.rank,2);
 assert.equal(a.rankings.lineOffense.rank,1);assert.equal(g.rankings.lineOffense.rank,1);
 assert.equal(l.rankings.passingOffense.rank,null);assert.equal(l.rankings.passingOffense.value,null);
 const sec=d.conferences.find(c=>c.name==='SEC');assert.equal(sec.rankings.passingOffense.contributingTeams,2);
 assert.equal(sec.metrics.adj_def_epa.weightField,'plays_def');assert.ok(Math.abs(sec.metrics.adj_def_epa.value-.0875)<1e-10);
 assert.equal(a.rankings.overall.uncertainty,null);assert.equal(d.model.canAuthorizeWager,false);
});
test('interconference records use only official final FBS pairs and season conferences',()=>{
 const d=buildSdvIntelligence(csv);
 attachSdvResults(d,'game_id,season,status,home_id,away_id,home_score,away_score,home_team,away_team,game_date\n1,2026,STATUS_FINAL,333,99,20,10,Alabama,LSU,2026-10-01\n2,2026,STATUS_FINAL,333,999999,30,10,Alabama,FCS,2026-10-02\n3,2026,STATUS_IN_PROGRESS,333,99,30,10,Alabama,LSU,2026-10-03\n');
 const s=d.conferences.find(c=>c.name==='SEC').interconference;assert.equal(s.games,1);assert.equal(s.wins,1);assert.equal(s.pointsFor,20);
 const a=d.teams.find(t=>t.espnId==='333');assert.equal(a.record.sourceFinalGames,2);assert.equal(a.record.sourceFbsFinalGames,1);assert.equal(a.summaryScope.excludedNonFbsFinalGames,1);assert.equal(a.summaryGameGap,0);
});
test('source/API acceptance rejects missing, duplicated, non-FBS and reversed cards',()=>{
 const game={id:'1',sport:'cfb',season:2026,start:'2026-10-17T19:00Z',home:{espnId:'333'},away:{espnId:'61'}};
 const source={games:[game],coverage:{successfulDays:7},observedAt:'2026-10-11T15:00Z'};
 assert.equal(reconcileCfbWindow(source,{games:[game]}).passed,true);
 const forecast={...game,projHomeScore:24,projAwayScore:17,modelVersion:'CFB-FBIS-v2',cfbFbisV2:{provisional:true,canAuthorizeWager:false}};
 const audited=reconcileCfbWindow(source,{games:[forecast]});assert.equal(audited.projectionShapeRecognized,1);assert.equal(audited.provisionalForecasts,1);assert.equal(audited.qualificationBlocked,1);
 assert.equal(reconcileCfbWindow(source,{games:[]}).passed,false);
 assert.equal(reconcileCfbWindow(source,{games:[game,game]}).passed,false);
 assert.equal(reconcileCfbWindow(source,{games:[{...game,away:{espnId:'999999'}}]}).passed,false);
 assert.equal(reconcileCfbWindow(source,{games:[{...game,home:game.away,away:game.home}]}).passed,false);
 assert.equal(reconcileCfbWindow({...source,coverage:{successfulDays:6}},{games:[game]}).passed,false);
});
