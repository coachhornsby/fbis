import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {copyCbbExactPage,compareCbbExactPage} from '../functions/lib/cbbExactMigration.js';
import {productSportDbHandle} from '../functions/lib/databaseTopology.js';
function database(){
 const raw=new DatabaseSync(':memory:');let fail=false;
 const db={raw,setFail(v){fail=v;},prepare(sql){const wrap=args=>({sql,args,bind(...v){return wrap(v);},async all(){return {results:raw.prepare(sql).all(...args)};},async first(){return raw.prepare(sql).get(...args)||null;},async run(){return raw.prepare(sql).run(...args);}});return wrap([]);},async batch(statements){raw.exec('BEGIN');try{for(const s of statements){if(fail&&s.sql.includes('cbb_migration_progress'))throw Error('injected checkpoint failure');raw.prepare(s.sql).run(...s.args);}raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}}};return db;
}
function setup(){const primary=database(),target=database();const schema='CREATE TABLE published_projections(id INTEGER PRIMARY KEY,sport TEXT NOT NULL,payload_json TEXT,observed_at TEXT); CREATE TABLE team_form(sport TEXT, season INTEGER, team_key TEXT, value TEXT, PRIMARY KEY(sport,season,team_key));';for(const db of [primary,target])db.raw.exec(schema);return {primary,target,env:{DB:primary,CBB_DB:target,SPORT_DB_MODE_CBB:'shadow'}};}
test('exact IDs, provenance JSON, old timestamps and sport scoping survive resumable pages',async()=>{
 const {primary,target,env}=setup();primary.raw.exec(`INSERT INTO published_projections VALUES(1,'cbb','{"license":"restricted","nested":[1,null]}','2020-01-01'),(2,'nba','other','2026-01-01'),(3,'cbb','later','2020-01-02')`);
 const a=await copyCbbExactPage(env,'published_projections',{pageSize:1,maxPages:1});assert.equal(a.exhausted,false);
 await copyCbbExactPage(env,'published_projections',{pageSize:1,maxPages:5});
 assert.deepEqual(target.raw.prepare('SELECT * FROM published_projections').all(),primary.raw.prepare("SELECT * FROM published_projections WHERE sport='cbb'").all());
 assert.equal((await compareCbbExactPage(env,'published_projections')).ok,true);
 primary.raw.exec("UPDATE published_projections SET payload_json='updated-without-new-timestamp' WHERE id=1");
 assert.equal((await compareCbbExactPage(env,'published_projections')).ok,false);
 await copyCbbExactPage(env,'published_projections',{maxPages:5});assert.equal((await compareCbbExactPage(env,'published_projections')).ok,true);
});
test('atomic checkpoint failure rolls back page; restart loses no key ranges',async()=>{
 const {primary,target,env}=setup();primary.raw.exec("INSERT INTO published_projections VALUES(10,'cbb','original','2020')");
 target.setFail(true);await assert.rejects(copyCbbExactPage(env,'published_projections'),/injected/);
 assert.equal(target.raw.prepare('SELECT COUNT(*) n FROM published_projections').get().n,0);
 assert.equal(target.raw.prepare('SELECT COUNT(*) n FROM cbb_migration_progress').get().n,0);
 target.setFail(false);await copyCbbExactPage(env,'published_projections');assert.equal((await compareCbbExactPage(env,'published_projections')).ok,true);
});
test('composite-key resume and reverse membership detect target extras',async()=>{
 const {primary,target,env}=setup();primary.raw.exec("INSERT INTO team_form VALUES('cbb',2026,'A','a'),('cbb',2026,'B','b'),('nba',2026,'C','c')");
 await copyCbbExactPage(env,'team_form',{pageSize:1,maxPages:1});await copyCbbExactPage(env,'team_form',{pageSize:1,maxPages:5});
 assert.equal((await compareCbbExactPage(env,'team_form')).ok,true);
 target.raw.exec("INSERT INTO team_form VALUES('cbb',2026,'Z','extra')");assert.equal((await compareCbbExactPage(env,'team_form')).ok,false);
});
test('activation refuses shadow copying and missing strict flag cannot expose PRIMARY',async()=>{
 const {env}=setup();env.SPORT_DB_MODE_CBB='sport';await assert.rejects(copyCbbExactPage(env,'team_form'),/SHADOW/);
 assert.equal(productSportDbHandle(env,'cbb').db,null);
});
test('props and unapproved tables cannot enter migration scope; schema drift refuses writes',async()=>{
 const {env,target}=setup();await assert.rejects(copyCbbExactPage(env,'cbb_player_prop_signals'),/ALLOWLISTED/);
 target.raw.exec('DROP TABLE published_projections; CREATE TABLE published_projections(id TEXT PRIMARY KEY,sport TEXT NOT NULL,payload_json TEXT,observed_at TEXT)');
 await assert.rejects(copyCbbExactPage(env,'published_projections'),/SCHEMA/);
});
test('atomic activation fence stops an in-flight shadow page from overwriting new private data',async()=>{
 const {primary,target,env}=setup();primary.raw.exec("INSERT INTO published_projections VALUES(1,'cbb','old-primary','2020')");target.raw.exec("INSERT INTO published_projections VALUES(1,'cbb','new-private','2020')");
 await assert.rejects(copyCbbExactPage(env,'published_projections',{validatePage:async()=>{target.raw.exec("UPDATE cbb_migration_fence SET state='paused' WHERE id=1");}}),/CHECK/);
 assert.equal(target.raw.prepare('SELECT payload_json FROM published_projections').get().payload_json,'new-private');assert.equal(target.raw.prepare('SELECT COUNT(*) n FROM cbb_migration_progress').get().n,0);
});
