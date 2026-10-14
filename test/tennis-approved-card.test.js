import test from 'node:test';
import assert from 'node:assert/strict';
import { tennisProjectionDisplay, neutralTennisAthlete, splitTennisName } from '../src/lib/tennisCardPresentation.js';
import { validateTennisPrematchProfiles, runTennisProjectionPipeline } from '../functions/lib/tennisProjectionPipeline.js';
import { persistTennisV2Decision } from '../functions/lib/tennisV2Ledger.js';
import { onRequestPost, onRequestGet } from '../functions/api/tennis-projection-coverage.js';
const now = new Date('2026-10-14T17:00:00Z');
const game = { home:{name:'Player One'},away:{name:'Player Two'},modelVersion:'real-model-version',tennisProjection:{eventIntegrity:{valid:true},player1WinProb:.61,player2WinProb:.39,decisionTimestamp:now.toISOString()},market:{reference:{observedAt:now.toISOString(),noVig:{home:.57,away:.43}}}};
test('only authoritative paired PURE probabilities render; market and research approximations cannot substitute',()=>{
  assert.equal(tennisProjectionDisplay(game,+now).pHome,.61);
  for (const t of [{...game.tennisProjection,eventIntegrity:{valid:false}},{...game.tennisProjection,player1WinProb:null},{...game.tennisProjection,player2WinProb:.6}]) {
    const d=tennisProjectionDisplay({...game,tennisProjection:t},+now);assert.equal(d.valid,false);assert.equal(d.pHome,null);assert.equal(d.edgeHome,null);
  }
});
test('edges require contemporaneous paired prices and actual quote clocks',()=>{
  assert.ok(Math.abs(tennisProjectionDisplay(game,+now).edgeHome-4)<.0001);
  for (const observedAt of [null,'2026-10-13T12:00:00Z','2026-10-15T12:00:00Z']) {
    assert.equal(tennisProjectionDisplay({...game,market:{reference:{...game.market.reference,observedAt}}},+now).edgeHome,null);
  }
  assert.equal(tennisProjectionDisplay({...game,tennisProjection:{...game.tennisProjection,decisionTimestamp:'2026-10-13T12:00:00Z'}},+now).edgeHome,null);
});
test('long names keep complete words and neutral athletes carry no national flag',()=>{
  assert.deepEqual(splitTennisName('Guiomar Maristany Zuleta De Reales'),{first:'Guiomar',last:'Maristany Zuleta De Reales'});
  assert.equal(neutralTennisAthlete('RUS'),true);assert.equal(neutralTennisAthlete('BLR'),true);assert.equal(neutralTennisAthlete('UA'),false);
});
const profile={player_name:'Player One',profile_json:JSON.stringify({name:'Player One',historyMatches:12,surfaceMatches:8,servePointWin:.63,returnPointWin:.37,firstServeIn:.62,firstServeWin:.68,secondServeWin:.5,returnFirstWin:.3,returnSecondWin:.5,aceRate:.05,doubleFaultRate:.04,bpSaveRate:.6,bpFacedPerServiceGame:.3,servicePointsPerGame:6.4,bpCreatePerReturnGame:.3,bpConvertRate:.4,aceAllowedRate:.05,dfReceivedRate:.04}),source:'VERIFIED_RESEARCH',source_license:'permitted',source_as_of:'2026-10-13T00:00:00Z',updated_at:'2026-10-13T01:00:00Z',last_match_date:'2026-10-12'};
test('inference blocks missing, unproven, future, or identity-mismatched prematch profiles',()=>{
 const f={event_start_time:'2026-10-15T00:00:00Z'};
 assert.equal(validateTennisPrematchProfiles([profile,profile],f,now),null);
 assert.equal(validateTennisPrematchProfiles([profile,null],f,now),'SURFACE_PROFILE_MISSING');
 assert.equal(validateTennisPrematchProfiles([profile,{...profile,source_license:null}],f,now),'PROFILE_PROVENANCE_MISSING');
 assert.equal(validateTennisPrematchProfiles([profile,{...profile,source_as_of:'2026-10-16T00:00:00Z'}],f,now),'PROFILE_CUTOFF_UNVERIFIED');
 assert.equal(validateTennisPrematchProfiles([profile,{...profile,player_name:'Wrong Player'}],f,now),'PROFILE_IDENTITY_MISMATCH');
});
test('PURE fixture persistence accepts no market without inventing market probabilities or authorizing',async()=>{
 let values,sql;
 const db={prepare(q){sql=q;return {bind(...args){values=args;return {async run(){return {meta:{changes:1}}}}}}}};
 const d=await persistTennisV2Decision(db,{eventId:'official-match',tour:'wta',player1:'Player One',player2:'Player Two',pureP1:.61,market:null,snapshotType:'PURE_FIXTURE'});
 assert.equal(d.inserted,true);assert.equal(values[7],.61);assert.equal(values[8],null);assert.equal(values[9],null);assert.equal(values[11],null);assert.match(sql,/0,0,0/);
 assert.equal((await persistTennisV2Decision(db,{pureP1:.61,market:null})).inserted,false);
});
test('zero official fixtures reports zero coverage and writes no synthetic outputs',async()=>{
 const db={prepare(sql){assert.match(sql,/FROM tennis_official_matches/);return {bind(){return {async all(){return {results:[]}}}}}}};
 const d=await runTennisProjectionPipeline(db,{now});assert.equal(d.verifiedFixtures,0);assert.equal(d.inserted,0);assert.deepEqual(d.attempts,[]);assert.equal(d.canAuthorizeWager,false);
});
test('coverage read is fail-closed; inference write requires harvest authorization',async()=>{
 assert.equal((await onRequestGet({env:{}})).status,503);
 assert.equal((await onRequestPost({request:new Request('https://example.test'),env:{HARVEST_SECRET:'secret'}})).status,403);
});

test('verified fixture → real v2 inference → persisted probability/total → coverage readback; second run is idempotent',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {readFileSync}=await import('node:fs');
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT)');
 for(const name of ['0073_tennis_canonical_player_bank.sql','0094_tennis_wta_match_history_pit.sql','0050_tennis_v2_market_context.sql','0051_tennis_v2_current_profiles.sql']) sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 sql.exec("CREATE TABLE action_event_identity_links(canonical_event_id TEXT,provider_event_id TEXT,sport TEXT,match_confidence TEXT)");
 const db={prepare(query){const st=sql.prepare(query);return {bind(...args){return {async all(){return {results:st.all(...args)}},async first(){return st.get(...args)||null},async run(){return {meta:{changes:st.run(...args).changes}}}}}}}};
 const clock=new Date(), observed=new Date(+clock-3600000).toISOString(), start=new Date(+clock+86400000).toISOString(), last=new Date(+clock-86400000).toISOString();
 for(const [id,name] of [['p1','Player One'],['p2','Player Two']]) {
   sql.prepare(`INSERT INTO tennis_players(fbis_player_id,tour,canonical_name,normalized_name,created_at,updated_at) VALUES(?,'wta',?,?,?,?)`).run(id,name,name.toLowerCase(),observed,observed);
   const p={id,name,historyMatches:30,surfaceMatches:15,firstServeIn:.62,firstServeWin:.68,secondServeWin:.5,servePointWin:.61,returnPointWin:.4,returnFirstWin:.3,returnSecondWin:.5,aceRate:.05,doubleFaultRate:.04,bpSaveRate:.6,bpFacedPerServiceGame:.3,servicePointsPerGame:6.4,bpCreatePerReturnGame:.3,bpConvertRate:.4,aceAllowedRate:.05,dfReceivedRate:.04};
   sql.prepare(`INSERT INTO tennis_player_profiles_current(tour,player_key,player_name,surface,profile_json,last_match_date,source,source_license,source_as_of,updated_at) VALUES('wta',?,?,'hard',?,?,'VERIFIED_RESEARCH','permitted',?,?)`).run(name.toLowerCase(),name,JSON.stringify(p),last,observed,observed);
 }
 sql.prepare(`INSERT INTO tennis_official_matches(match_id,tour,source,source_match_id,tournament_name,tournament_level,match_time,surface,player1_id,player2_id,completion_state,observed_at,ingested_at,provenance_json) VALUES('verified','wta','WTA_OFFICIAL','source-id','Verified Open','WTA 500',?,'hard','p1','p2','SCHEDULED',?,?,'{}')`).run(start,observed,observed);
 const first=await runTennisProjectionPipeline(db,{now:clock});
 assert.equal(first.verifiedFixtures,1);assert.equal(first.inserted,1);
 const stored=sql.prepare('SELECT * FROM tennis_v2_research_decisions').get();
 assert.ok(stored.pure_p1>0&&stored.pure_p1<1);assert.equal(stored.market_prior_p1,null);assert.equal(stored.market_v2_p1,null);assert.equal(stored.can_authorize_wager,0);
 assert.ok(JSON.parse(stored.context_json).projectedTotalGames>0);
 const second=await runTennisProjectionPipeline(db,{now:new Date()});assert.equal(second.successfulProjections,1);assert.equal(second.inserted,0);sql.close();
});
