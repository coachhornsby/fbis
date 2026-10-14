import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { officialWtaMatchState, ingestOfficialWtaSchedule, captureOfficialWtaSchedule } from '../functions/lib/tennisOfficialSchedule.js';
import { runTennisProjectionPipeline } from '../functions/lib/tennisProjectionPipeline.js';
import { onRequestPost } from '../functions/api/tennis-official-schedule.js';
const now=new Date('2026-10-14T18:00:00Z');
const t={tournamentGroup:{id:1075,level:'WTA 1000'},year:2026,title:'Wuhan Open',level:'WTA 1000',surface:'Hard',inOutdoor:'O',city:'Wuhan',country:'CHN'};
const m={EventID:'1075',EventYear:2026,MatchID:'LS014',MatchState:'U',DrawMatchType:'S',MatchTimeStamp:'2026-10-15T11:00+08:00',NotBeforeISOTime:'11:00+0800',NotBefore:'Starting at 11:00 AM',PlayerIDA:'322191',PlayerIDB:'330482',PlayerNameFirstA:'Karolina',PlayerNameLastA:'Muchova',PlayerNameFirstB:'Diana',PlayerNameLastB:'Shnaider',CourtName:'Center Court',RoundID:4};
test('official match clock is timezone-normalized and followed-by 23:59 placeholders are never scheduled starts',()=>{
 assert.deepEqual(officialWtaMatchState(m,t,{now}),{state:'SCHEDULED',start:'2026-10-15T03:00:00.000Z',reason:null});
 for(const changes of [{Unscheduled:true,MatchTimeStamp:'2026-10-15T23:59+08:00',NotBeforeISOTime:''},{isEstimatedStartTime:true},{MatchTimeStamp:'2026-10-15T11:00:00'},{NotBeforeISOTime:'12:00+0800'}]) {
  const r=officialWtaMatchState({...m,...changes},t,{now});assert.equal(r.state,'TIME_UNVERIFIED');assert.equal(r.start,null);
 }
 assert.equal(officialWtaMatchState({...m,DrawMatchType:'D'},t,{now}).reason,'NOT_SINGLES');
 assert.equal(officialWtaMatchState({...m,EventID:'2092'},t,{now}).reason,'OFFICIAL_TOURNAMENT_IDENTITY_MISMATCH');
});
function database(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT)');for(const name of ['0073_tennis_canonical_player_bank.sql','0094_tennis_wta_match_history_pit.sql'])sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));for(const [id,name]of [['322191','Karolina Muchova'],['330482','Diana Shnaider']]){sql.prepare("INSERT INTO tennis_players(fbis_player_id,tour,canonical_name,normalized_name,created_at,updated_at) VALUES(?,'wta',?,?,?,?)").run('tennis:wta:'+id,name,name.toLowerCase(),now.toISOString(),now.toISOString());sql.prepare("INSERT INTO tennis_player_source_ids(provider,source_player_id,fbis_player_id,first_seen_at,last_seen_at) VALUES('WTA_OFFICIAL',?,?,?,?)").run(id,'tennis:wta:'+id,now.toISOString(),now.toISOString());}return {sql,db:{prepare(q){const st=sql.prepare(q);return {bind(...args){return {async all(){return {results:st.all(...args)}},async first(){return st.get(...args)||null},async run(){return {meta:{changes:st.run(...args).changes}}}}}}}}};}
test('real schema replay persists canonical IDs, exact surface/tournament, immutable raw evidence, and truthful reschedules',async()=>{
 const {sql,db}=database(),raws=[];const bucket={async put(key,body){raws.push({key,body})}};
 let r=await ingestOfficialWtaSchedule(db,bucket,t,{tournament:t,matches:[m]},{now});assert.equal(r.written,1);
 let row=sql.prepare('SELECT * FROM tennis_official_matches').get();assert.equal(row.player1_id,'tennis:wta:322191');assert.equal(row.player2_id,'tennis:wta:330482');assert.equal(row.tournament_name,'Wuhan Open');assert.equal(row.surface,'hard');assert.equal(row.match_time,'2026-10-15T03:00:00.000Z');assert.equal(row.completion_state,'SCHEDULED');assert.ok(row.raw_artifact_key);assert.equal(raws.length,1);
 await ingestOfficialWtaSchedule(db,bucket,t,{tournament:t,matches:[{...m,Unscheduled:true,NotBeforeISOTime:'',MatchTimeStamp:'2026-10-15T23:59+08:00'}]},{now:new Date(+now+1000)});
 row=sql.prepare('SELECT * FROM tennis_official_matches').get();assert.equal(row.completion_state,'TIME_UNVERIFIED');assert.equal(row.match_time,null);assert.equal(sql.prepare('SELECT count(*) n FROM tennis_official_match_observations').get().n,2);
 await ingestOfficialWtaSchedule(db,bucket,t,{tournament:t,matches:[m]},{now});assert.equal(sql.prepare('SELECT completion_state FROM tennis_official_matches').get().completion_state,'TIME_UNVERIFIED');sql.close();
});
test('unresolved official IDs are retained as blocked source diagnostics, never guessed from names',async()=>{
 const {sql,db}=database();const r=await ingestOfficialWtaSchedule(db,{async put(){}},t,{tournament:t,matches:[{...m,PlayerIDA:'999999'}]},{now});assert.equal(r.written,0);assert.equal(r.reasons.CANONICAL_PLAYER_LINK_MISSING,1);sql.close();
});
test('contract drift and unauthenticated source capture fail closed',async()=>{
 const r=await onRequestPost({request:new Request('https://example.test'),env:{HARVEST_SECRET:'secret'}});assert.equal(r.status,403);
 await assert.rejects(captureOfficialWtaSchedule({DB:{prepare(){}},ARCHIVE:{put(){}}},{now,fetchImpl:async()=>new Response('{}')}),/WTA_TOURNAMENT_LIST_UNVERIFIED/);
});
test('official source payload → canonical schedule → real v2 inference → persisted coverage works end to end',async()=>{
 const {sql,db}=database();for(const name of ['0050_tennis_v2_market_context.sql','0051_tennis_v2_current_profiles.sql'])sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));sql.exec('CREATE TABLE action_event_identity_links(canonical_event_id TEXT,provider_event_id TEXT,sport TEXT,match_confidence TEXT)');
 const clock=new Date(),start=new Date(+clock+86400000),cutoff=new Date(+clock-3600000).toISOString();
 const tournament={...t,year:clock.getUTCFullYear()};
 const match={...m,EventYear:clock.getUTCFullYear(),MatchTimeStamp:start.toISOString(),NotBeforeISOTime:start.toISOString().slice(11,16)+'Z'};
 for(const name of ['Karolina Muchova','Diana Shnaider']){
  const p={name,historyMatches:30,surfaceMatches:15,firstServeIn:.62,firstServeWin:.68,secondServeWin:.5,servePointWin:.61,returnPointWin:.4,returnFirstWin:.3,returnSecondWin:.5,aceRate:.05,doubleFaultRate:.04,bpSaveRate:.6,bpFacedPerServiceGame:.3,servicePointsPerGame:6.4,bpCreatePerReturnGame:.3,bpConvertRate:.4,aceAllowedRate:.05,dfReceivedRate:.04};
  sql.prepare("INSERT INTO tennis_player_profiles_current(tour,player_key,player_name,surface,profile_json,last_match_date,source,source_license,source_as_of,updated_at) VALUES('wta',?,?,'hard',?,?,'VERIFIED_RESEARCH','PERMITTED',?,?)").run(name.toLowerCase(),name,JSON.stringify(p),new Date(+clock-86400000).toISOString(),cutoff,cutoff);
 }
 const source=await ingestOfficialWtaSchedule(db,{async put(){}},tournament,{tournament,matches:[match]},{now:clock});assert.equal(source.written,1);
 const result=await runTennisProjectionPipeline(db,{now:new Date()});assert.equal(result.verifiedFixtures,1);assert.equal(result.inserted,1);const record=sql.prepare('SELECT * FROM tennis_v2_research_decisions').get();assert.equal(record.snapshot_type,'PURE_FIXTURE');assert.equal(record.market_prior_p1,null);assert.equal(record.can_authorize_wager,0);assert.ok(JSON.parse(record.context_json).projectedTotalGames>0);sql.close();
});
