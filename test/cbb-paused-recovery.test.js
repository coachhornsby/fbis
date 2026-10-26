import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {replayPausedCbbPage} from '../functions/lib/cbbPausedRecovery.js';
import {productSportDbHandle} from '../functions/lib/databaseTopology.js';
function database(){const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE odds_snapshots(id INTEGER PRIMARY KEY,sport TEXT,game_id TEXT,payload_json TEXT);');
 const prepare=(sql,args=[])=>({sql,args,bind(...v){return prepare(sql,v);},async all(){return {results:raw.prepare(sql).all(...args)};},async first(){return raw.prepare(sql).get(...args)||null;},async run(){return raw.prepare(sql).run(...args);}});
 return {raw,prepare,async batch(stmts){raw.exec('BEGIN');try{for(const s of stmts)raw.prepare(s.sql).run(...s.args);raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}}};}
function fixture(){const primary=database(),cbb=database();return {primary,cbb,env:{DB:primary,CBB_DB:cbb,SPORT_DB_MODE_CBB:'sport',SPORT_DB_STRICT_CBB:'true',CBB_ROLLBACK_RECOVERY_MODE:'paused'}};}
test('paused reverse replay restores exact records and preserves source and unrelated PRIMARY records',async()=>{
 const {primary,cbb,env}=fixture();primary.raw.exec("INSERT INTO odds_snapshots VALUES(50,'nfl','nfl-game','untouched')");cbb.raw.exec(`INSERT INTO odds_snapshots VALUES(100,'cbb','cbb-game','{"source":"restricted","as_of":"2020-01-01"}')`);
 const before=cbb.raw.prepare('SELECT * FROM odds_snapshots').all();assert.equal(productSportDbHandle(env,'cbb').db,null);
 const out=await replayPausedCbbPage(env,'odds_snapshots',{pageSize:1,maxPages:5});assert.equal(out.sourcePreserved,true);assert.equal(out.canAuthorizeWager,false);
 assert.deepEqual(cbb.raw.prepare('SELECT * FROM odds_snapshots').all(),before);assert.deepEqual(primary.raw.prepare("SELECT * FROM odds_snapshots WHERE sport='cbb'").all(),before);assert.equal(primary.raw.prepare("SELECT payload_json FROM odds_snapshots WHERE sport='nfl'").get().payload_json,'untouched');
});
test('numeric ID collisions stop paused replay without overwriting another sport',async()=>{
 const {primary,cbb,env}=fixture();primary.raw.exec("INSERT INTO odds_snapshots VALUES(1,'nfl','nfl-game','original')");cbb.raw.exec("INSERT INTO odds_snapshots VALUES(1,'cbb','cbb-game','incoming')");await assert.rejects(replayPausedCbbPage(env,'odds_snapshots'),/CROSS_SPORT_ID_COLLISION/);assert.equal(primary.raw.prepare('SELECT payload_json FROM odds_snapshots').get().payload_json,'original');assert.equal(cbb.raw.prepare('SELECT COUNT(*) n FROM odds_snapshots').get().n,1);
});
test('replay refuses active grants, unpaused mode and separately governed props',async()=>{
 const {env}=fixture();await assert.rejects(replayPausedCbbPage({...env,SPORT_CUTOVER_RECEIPT_CBB:'live'},'odds_snapshots'),/PAUSED/);await assert.rejects(replayPausedCbbPage({...env,CBB_ROLLBACK_RECOVERY_MODE:'running'},'odds_snapshots'),/PAUSED/);await assert.rejects(replayPausedCbbPage(env,'cbb_player_prop_signals'),/NOT_APPROVED/);
});
test('rollback refuses to replace a frozen model version in PRIMARY',async()=>{
 const {primary,cbb,env}=fixture();for(const d of [primary,cbb])d.raw.exec('CREATE TABLE prediction_snapshots(id TEXT PRIMARY KEY,sport TEXT,game_id TEXT,model_version TEXT,frozen_at TEXT,proj_total REAL)');
 primary.raw.exec("INSERT INTO prediction_snapshots VALUES('snap','cbb','1','frozen-v1','2020-01-01',140)");cbb.raw.exec("INSERT INTO prediction_snapshots VALUES('snap','cbb','1','changed-v2','2020-01-01',140)");
 await assert.rejects(replayPausedCbbPage(env,'prediction_snapshots'),/FROZEN_FIELD_CONFLICT/);assert.equal(primary.raw.prepare('SELECT model_version FROM prediction_snapshots').get().model_version,'frozen-v1');
});
