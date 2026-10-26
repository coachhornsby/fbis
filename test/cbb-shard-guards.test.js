import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';
import {SPORT_PREFIX_TABLES} from '../functions/lib/sportWorkingCopy.js';
import {CBB_SHARED_TABLES} from '../functions/lib/cbbExactMigration.js';
test('CBB shard rejects cross-sport inserts and updates for every shared working owner',()=>{
 const db=new DatabaseSync(':memory:');for(const table of CBB_SHARED_TABLES)db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,sport TEXT NOT NULL)`);
 db.exec(readFileSync('ops/sql/cbb-shared-sport-guards.sql','utf8'));
 for(const table of CBB_SHARED_TABLES){db.prepare(`INSERT INTO ${table} VALUES(?,?)`).run('cbb-id','cbb');assert.throws(()=>db.prepare(`INSERT INTO ${table} VALUES(?,?)`).run('bad','nba'),/CBB_CROSS_SPORT_ROW/);assert.throws(()=>db.prepare(`UPDATE ${table} SET sport=?`).run('nfl'),/CBB_CROSS_SPORT_ROW/);assert.equal(db.prepare(`SELECT sport FROM ${table}`).get().sport,'cbb');}
});
test('a new CBB research schema cannot bypass the migration catalog',()=>{
 const files=['schema.sql',...readdirSync('migrations').filter(x=>x.endsWith('.sql')).map(x=>'migrations/'+x)];const found=new Set(),renamed=new Map();
 for(const file of files){const source=readFileSync(file,'utf8');for(const m of source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?\b(cbb_[a-z0-9_]+)/ig))found.add(m[1]);for(const m of source.matchAll(/ALTER\s+TABLE\s+["`]?\b(cbb_[a-z0-9_]+)["`]?\s+RENAME\s+TO\s+["`]?\b(cbb_[a-z0-9_]+)/ig))renamed.set(m[1],m[2]);}
 for(const [from,to] of renamed){found.delete(from);found.add(to);}
 found.delete('cbb_player_prop_signals');assert.deepEqual([...found].sort(),[...SPORT_PREFIX_TABLES.cbb].sort());
});
