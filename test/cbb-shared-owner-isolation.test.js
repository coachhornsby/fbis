import {onRequestPost} from "../functions/api/track.js";
import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {queryGamesByIds,excludeSnapshotsForGame} from '../functions/lib/store.js';
function db(){const raw=new DatabaseSync(':memory:');raw.exec(`CREATE TABLE games(id TEXT PRIMARY KEY,sport TEXT,date TEXT,start TEXT,home_name TEXT,away_name TEXT,home_abbr TEXT,away_abbr TEXT);
CREATE TABLE prediction_snapshots(id TEXT,game_id TEXT,sport TEXT,projection_state TEXT,projection_flags TEXT,graded_at TEXT,actual_home REAL,actual_away REAL);
CREATE TABLE predictions(id TEXT,game_id TEXT,sport TEXT,projection_state TEXT,actual_home REAL,actual_away REAL);`);
return {raw,prepare(sql){return {async run(){return raw.prepare(sql).run();},bind(...args){return {async all(){return {results:raw.prepare(sql).all(...args)};},async first(){return raw.prepare(sql).get(...args)||null;},async run(){return raw.prepare(sql).run(...args);}};}};}};}
function fixture(){const primary=db(),cbb=db();return {primary,cbb,env:{DB:primary,CBB_DB:cbb,SPORT_DB_MODE_CBB:'sport',SPORT_DB_STRICT_CBB:'true',SPORT_DB_LEDGER_READY_CBB:'true',SPORT_CUTOVER_RECEIPT_CBB:'fixture',__fbisCutoverApprovals:new Map([['cbb:fixture',{status:'APPROVED'}]])}};}
test('game-ID fanout replaces stale PRIMARY CBB identity while retaining other sports',async()=>{
 const {primary,cbb,env}=fixture();primary.raw.exec("INSERT INTO games VALUES('1','cbb','2026-10-01','old','Stale','Away','ST','AW'),('2','nfl','2026-10-01','start','NFL','Other','NF','OT')");
 cbb.raw.exec("INSERT INTO games VALUES('1','cbb','2026-10-01','new','Current','Away','CU','AW')");
 const q=await queryGamesByIds(env,['1','2']);assert.equal(q.ok,true);assert.equal(q.rows.length,2);assert.equal(q.rows.find(r=>r.id==='1').home.name,'Current');assert.equal(q.rows.find(r=>r.id==='2').sport,'nfl');
 env.__fbisCutoverApprovals.set('cbb:fixture',{status:'REVOKED'});const failed=await queryGamesByIds(env,['1']);assert.equal(failed.ok,false);assert.deepEqual(failed.rows,[]);
});
test('learning exclusion writes only the approved CBB owner and leaves PRIMARY records intact',async()=>{
 const {primary,cbb,env}=fixture();for(const d of [primary,cbb])d.raw.exec("INSERT INTO prediction_snapshots VALUES('s','1','cbb','FROZEN',NULL,NULL,NULL,NULL); INSERT INTO predictions VALUES('p','1','cbb','FROZEN',NULL,NULL)");
 const before=primary.raw.prepare('SELECT * FROM prediction_snapshots').all();
 const out=await excludeSnapshotsForGame(env,{gameId:'1',sport:'cbb',reason:'isolated-drill'});assert.equal(out.ok,true);
 assert.equal(cbb.raw.prepare('SELECT projection_state FROM prediction_snapshots').get().projection_state,'LEARNING_EXCLUDED');assert.deepEqual(primary.raw.prepare('SELECT * FROM prediction_snapshots').all(),before);
 env.__fbisCutoverApprovals.clear();assert.equal((await excludeSnapshotsForGame(env,{gameId:'1',sport:'cbb'})).ok,false);assert.deepEqual(primary.raw.prepare('SELECT * FROM prediction_snapshots').all(),before);
});
test('future-grade cleanup preserves retained PRIMARY CBB grades and canonical wagering ownership',async()=>{
 const {primary,cbb,env}=fixture();const core=db();core.raw.exec("CREATE TABLE fbis_sport_cutover_approvals(receipt_id TEXT,sport TEXT,status TEXT,approved_at TEXT,expires_at TEXT,revoked_at TEXT); INSERT INTO fbis_sport_cutover_approvals VALUES('fixture','cbb','APPROVED',NULL,NULL,NULL)");env.CORE_DB=core;
 primary.raw.exec("CREATE TABLE strategy_tickets(id TEXT,result TEXT,profit REAL,clv REAL,graded_at TEXT,game_id TEXT); CREATE TABLE executed_bets(id TEXT,result TEXT,game_id TEXT);");
 for(const d of [primary,cbb])d.raw.exec("INSERT INTO games VALUES('1','cbb','2100-01-01','2100-01-01T12:00:00Z','Home','Away','H','A'); INSERT INTO prediction_snapshots VALUES('s','1','cbb','FROZEN',NULL,'2026-01-01',99,1); INSERT INTO predictions VALUES('p','1','cbb','FROZEN',99,1); ALTER TABLE predictions ADD COLUMN graded_at TEXT;");
 primary.raw.exec("INSERT INTO games VALUES('2','nfl','2100-01-01','2100-01-01T12:00:00Z','NFL','Away','N','A'); INSERT INTO prediction_snapshots VALUES('n','2','nfl','FROZEN',NULL,'2026-01-01',20,1);");
 const response=await onRequestPost({env,request:new Request('https://test/api/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'cleanup-future-grades'})})});
 assert.equal(response.status,200,await response.text());assert.equal(cbb.raw.prepare('SELECT actual_home FROM prediction_snapshots').get().actual_home,null);
 assert.equal(primary.raw.prepare("SELECT actual_home FROM prediction_snapshots WHERE sport='cbb'").get().actual_home,99);assert.equal(primary.raw.prepare("SELECT actual_home FROM prediction_snapshots WHERE sport='nfl'").get().actual_home,null);
});
