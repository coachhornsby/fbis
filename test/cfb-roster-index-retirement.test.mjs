import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
test('0108 reclaims only raw CFB secondary indexes, retains all rows and unique constraints',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT);
 CREATE TABLE cfb_roster_observations(id TEXT PRIMARY KEY,player_id TEXT,team_id TEXT,provider TEXT NOT NULL,
 provider_player_id TEXT,provider_team_id TEXT,season INTEGER,observed_at TEXT,content_hash TEXT,
 UNIQUE(provider,provider_player_id,provider_team_id,season,content_hash));
 CREATE INDEX idx_cfb_roster_obs_player_time ON cfb_roster_observations(player_id,season,observed_at DESC);
 CREATE INDEX idx_cfb_roster_obs_team_time ON cfb_roster_observations(team_id,season,observed_at DESC);`);
 db.prepare('INSERT INTO cfb_roster_observations VALUES(?,?,?,?,?,?,?,?,?)').run(
 'obs1','p1','t1','ESPN','1','t1',2004,'2026-10-15','a'.repeat(64));
 const query='SELECT rowid,id FROM cfb_roster_observations WHERE season=2004 AND rowid>0 ORDER BY rowid LIMIT 100';
 const original=db.prepare(query).all();
 const sql=readFileSync(new URL('../migrations/0108_cfb_archived_roster_index_retirement.sql',import.meta.url),'utf8');
 db.exec(sql);db.exec(sql);
 assert.deepEqual(db.prepare(query).all(),original);
 const names=db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cfb_roster_observations'").all().map(x=>x.name);
 assert.ok(!names.includes('idx_cfb_roster_obs_player_time'));
 assert.ok(!names.includes('idx_cfb_roster_obs_team_time'));
 assert.equal(names.filter(x=>x.startsWith('sqlite_autoindex_')).length,2);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE id='0108_cfb_archived_roster_index_retirement'").get().n,1);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM cfb_roster_observations').get().n,1);
 db.close();
});
test('fresh schema does not silently recreate retired expensive observation indexes',()=>{
 const ext=readFileSync(new URL('../schema.extensions.sql',import.meta.url),'utf8');
 assert.doesNotMatch(ext,/CREATE INDEX IF NOT EXISTS idx_cfb_roster_obs_(?:player|team)_time/i);
});
