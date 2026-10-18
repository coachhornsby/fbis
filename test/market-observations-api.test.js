import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/market-observations.js';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
test('expanded market details read current history-shard contracts without a cold archive flag',async()=>{
 const primary=new DatabaseSync(':memory:'),history=new DatabaseSync(':memory:');
 const schema=readFileSync(new URL('../sql/shards/market-history-v1.sql',import.meta.url),'utf8');
 primary.exec(schema);history.exec(schema);
 history.prepare(`INSERT INTO normalized_market_observations(id,observation_key,source,source_type,sport,canonical_event_id,market_family,period,side,contract_price,source_market_id,collected_at,created_at,raw_payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('one','one','Polymarket US WebSocket','prediction_market','tennis','match','total','first_set','over',.52,'m','2026-10-18T20:00:00Z','2026-10-18T20:00:00Z','{"sourceObservedAt":null}');
 const wrap=sqlite=>({prepare(sql){const st=sqlite.prepare(sql);return {bind(...args){return {all:async()=>({results:st.all(...args)})}}}}});
 const response=await onRequestGet({env:{DB:wrap(primary),MARKET_HISTORY_DB:wrap(history)},request:new Request('https://fbis.test/api/market-observations?sport=tennis&eventId=match')});
 const result=await response.json();assert.equal(response.status,200);assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].period,'first_set');assert.equal(result.rows[0].contractPrice,.52);
 assert.equal(result.rows[0].providerObservedAt,null);assert.equal(result.rows[0].canAuthorizeWager,false);
 primary.close();history.close();
});
test('event market pagination exposes continuation and preserves unknown provider time',async()=>{
 const at=new Date().toISOString(),records=Array.from({length:101},(_,i)=>({id:'row'+i,source:'Polymarket US',sport:'mlb',canonical_event_id:'event',source_market_id:'market'+i,source_outcome_id:'yes',contract_price:0.6,collected_at:at,source_observed_at:at,raw_payload_json:'{"sourceObservedAt":null}'}));
 const env={DB:{prepare(sql){assert.match(sql,/source_outcome_id,period,side,line/);return{bind(...args){assert.deepEqual(args,['mlb','event',101,0]);return{async all(){return{results:records}}}}}}}};
 const result=await (await onRequestGet({env,request:new Request('https://fbis.test/api/market-observations?sport=mlb&eventId=event')})).json();
 assert.equal(result.rows.length,100);assert.equal(result.nextCursor,'100');assert.equal(result.rows[0].providerObservedAt,null);assert.equal(result.rows[0].temporal.status,'SOURCE_TIME_UNKNOWN');assert.equal(result.rows[0].canAuthorizeWager,false);
});
test('invalid event scope cannot query the ledger',async()=>{
 const response=await onRequestGet({env:{},request:new Request('https://fbis.test/api/market-observations?sport=bogus&eventId=event')});assert.equal(response.status,400);
});
test('capacity index retirement preserves every quote and its identity constraints',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../sql/shards/market-history-v1.sql',import.meta.url),'utf8'));
 db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT); CREATE INDEX idx_norm_market_snapshot ON normalized_market_observations(snapshot_type,sport,collected_at)');
 db.prepare(`INSERT INTO normalized_market_observations(id,observation_key,source,source_type,sport,market_family,collected_at,created_at) VALUES(?,?,?,?,?,?,?,?)`).run('one','one','PinnOdds','bookmaker','nfl','moneyline','2026-10-18','2026-10-18');
 const before=db.prepare('SELECT * FROM normalized_market_observations').all();
 db.exec(readFileSync(new URL('../migrations/0116_market_snapshot_index_retirement.sql',import.meta.url),'utf8'));
 assert.deepEqual(db.prepare('SELECT * FROM normalized_market_observations').all(),before);
 assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='idx_norm_market_snapshot'").get(),undefined);
 assert.throws(()=>db.prepare(`INSERT INTO normalized_market_observations SELECT * FROM normalized_market_observations`).run(),/UNIQUE/);
 db.close();
});
