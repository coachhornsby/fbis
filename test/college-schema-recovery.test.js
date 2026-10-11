import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { preflightSql, verifyInventory } from '../scripts/college-schema-preflight.mjs';
import { insertSourceObservation, insertTeamFeatureSnapshot, insertGameFeatureSnapshot, recordApiUsage, upsertTeamSeasonIdentity } from '../functions/lib/collegeStore.js';
const original = readFileSync(new URL('../migrations/0009_college_research.sql', import.meta.url), 'utf8');
const recovery = readFileSync(new URL('../migrations/0098_college_persistence_recovery.sql', import.meta.url), 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT); INSERT INTO schema_migrations VALUES('0009_college_research','2026-10-06 15:21:01'),('0086_migration_lineage_reconciliation','2026-10-06 15:21:01'); CREATE TABLE protected_evidence(id TEXT PRIMARY KEY, payload TEXT); INSERT INTO protected_evidence VALUES('keep','original');");
  return db;
}
function inventory(db) { return preflightSql().split(';').filter(s=>s.trim()).flatMap(sql=>db.prepare(sql).all()); }
function envFor(db) { return {DB:{prepare(sql){return {bind(...args){return {async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;}};}};}}}; }
test('unverified empty capture cannot authorize missing-object recovery',()=>{
  assert.equal(verifyInventory([]).ok,false);
  assert.equal(verifyInventory([{target:'COLLEGE_SCHEMA_PREFLIGHT_V1',kind:'probe'}]).ok,false);
});
test('AUTOINCREMENT and extra constraints cannot silently drift before registration',()=>{
  for (const change of [s=>s.replace('AUTOINCREMENT',''),s=>s.replace('id TEXT PRIMARY KEY,','id TEXT PRIMARY KEY CHECK(length(id)>0),')]) {
    const db=fixture();db.exec(change(original));
    assert.equal(verifyInventory(inventory(db)).ok,false);
    assert.throws(()=>db.exec(recovery));
    assert.equal(db.prepare("SELECT count(*) n FROM schema_migrations WHERE id='0098_college_persistence_recovery'").get().n,0);
  }
});
test('unexpected uniqueness or writer-changing triggers block recovery',()=>{
  for (const extra of ['CREATE UNIQUE INDEX unexpected ON source_observations(sport)', "CREATE TRIGGER unexpected BEFORE INSERT ON source_observations BEGIN SELECT RAISE(ABORT,'blocked'); END"]) {
    const db=fixture();db.exec(original);db.exec(extra);
    assert.equal(verifyInventory(inventory(db),{post:true}).ok,false);
    assert.throws(()=>db.exec(recovery));
    assert.equal(db.prepare("SELECT count(*) n FROM schema_migrations WHERE id='0098_college_persistence_recovery'").get().n,0);
  }
});
test('observed ledger-only fixture fails postflight; forward recovery verifies actual objects',()=>{
  const db=fixture(); assert.equal(verifyInventory(inventory(db),{post:true}).ok,false);
  db.exec(recovery); assert.equal(verifyInventory(inventory(db),{post:true}).ok,true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE id='0098_college_persistence_recovery'").get().n,1);
  assert.equal(db.prepare('SELECT payload FROM protected_evidence').get().payload,'original');
});
test('recovered columns, constraints, indexes and foreign keys match original migration exactly',()=>{
  const a=fixture(),b=fixture();a.exec(original);b.exec(recovery);
  assert.deepEqual(inventory(b),inventory(a));
  assert.throws(()=>b.exec("INSERT INTO team_season_identity(canonical_id,sport,season,updated_at) VALUES('x','cfb',2026,'t'),('x','cfb',2026,'t')"),/UNIQUE/);
  assert.throws(()=>b.exec("INSERT INTO source_observations(id) VALUES('bad')"),/NOT NULL/);
});
test('repeat recovery preserves existing data, prior ledger clocks and registration count',()=>{
  const db=fixture();db.exec(recovery);db.exec("INSERT INTO source_observations(id,source,sport,endpoint,observed_at,retrieved_at) VALUES('e','cfbd','cfb','/games','source-clock','capture-clock')");
  db.exec(recovery);assert.equal(db.prepare('SELECT observed_at FROM source_observations').get().observed_at,'source-clock');
  assert.equal(db.prepare("SELECT applied_at FROM schema_migrations WHERE id='0009_college_research'").get().applied_at,'2026-10-06 15:21:01');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE id='0098_college_persistence_recovery'").get().n,1);
});
test('conflicting existing schema fails before registration; transactional rollback preserves original objects',()=>{
  const db=fixture();db.exec('CREATE TABLE source_observations(id INTEGER PRIMARY KEY)');
  assert.equal(verifyInventory(inventory(db)).ok,false);
  db.exec('BEGIN'); assert.throws(()=>db.exec(recovery)); db.exec('ROLLBACK');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE id='0098_college_persistence_recovery'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='team_feature_snapshots'").get().n,0);
});
test('five real writers and snapshot readers operate against recovered destinations',async()=>{
  const db=fixture();db.exec(recovery);const env=envFor(db),clock='2026-10-09T12:00:00Z';
  assert.equal((await insertSourceObservation(env,{id:'source',source:'cfbd',sport:'cfb',endpoint:'/games',observedAt:clock,retrievedAt:clock})).ok,true);
  assert.equal((await insertTeamFeatureSnapshot(env,{id:'team',sport:'cfb',teamId:'cfb:rice',asOf:clock,featureVersion:'fixture',features:{epa:null},missingness:{epa:true}})).ok,true);
  assert.equal((await insertGameFeatureSnapshot(env,{id:'game',sport:'cfb',gameId:'401862797',featureCutoff:clock,featureSchemaVersion:'fixture',features:{epa:0}})).ok,true);
  assert.equal((await recordApiUsage(env,{source:'cfbd',endpoint:'/games',month:'2026-10',capturedAt:clock})).ok,true);
  assert.equal((await upsertTeamSeasonIdentity(env,{canonicalId:'cfb:rice',sport:'cfb',season:2026,updatedAt:clock})).ok,true);
  assert.deepEqual(JSON.parse(db.prepare('SELECT features_json FROM team_feature_snapshots').get().features_json),{epa:null});
  assert.deepEqual(JSON.parse(db.prepare('SELECT features_json FROM game_feature_snapshots').get().features_json),{epa:0});
  assert.equal((await insertSourceObservation(env,{id:'source',source:'changed',sport:'cfb',endpoint:'/games',observedAt:clock,retrievedAt:clock})).already,1);
});
