import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {rowSql,sqlValue,identifier,assertRowsEqual,PRIMARY_DB,COLD_DB} from '../scripts/lib/storage-full-core.mjs';
test('cold SQL preserves sparse rowids, quotes, Unicode, nulls, embedded NUL and precision',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'full-cold-'));
 try{
 const migration=await readFile(new URL('../migrations/0095_normalized_market_observation_ledger.sql',import.meta.url),'utf8');
 const schema=migration.match(/CREATE TABLE IF NOT EXISTS normalized_market_observations \([\s\S]*?\n\);/)[0].replace(' IF NOT EXISTS','');
 const columns=schema.split('\n').slice(1,-1).map(x=>x.trim().split(' ')[0]);
 const make=(id,rowid)=>({...Object.fromEntries(columns.map(c=>[c,null])),__source_rowid:String(rowid),id,observation_key:id,source:'source',source_type:'fixture',sport:'nfl',market_family:'spread',snapshot_type:'RESEARCH',collected_at:'2026-10-13',created_at:'2026-10-13',decision_eligible:0,can_qualify:0,can_authorize_wager:0,player_name:"O'Brien é\0name",line:1.125});
 const rows=[make('a',2),make("b'",99)],sql=schema.replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS ')+'\n'+rowSql('normalized_market_observations',columns,rows);
 await writeFile(join(dir,'sql'),sql);await writeFile(join(dir,'part.gz'),gzipSync(JSON.stringify({contract:'fbis-full-cold-part-v1',table:'normalized_market_observations',schema,columns,rows,afterRowid:0})));
 const r=spawnSync('python3',['-c',"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[2]);c.executescript(open(sys.argv[1]).read());c.executescript(open(sys.argv[1]).read());c.row_factory=sqlite3.Row;print(json.dumps([dict(x) for x in c.execute('SELECT CAST(rowid AS TEXT) __source_rowid,* FROM normalized_market_observations ORDER BY rowid')]))",join(dir,'sql'),join(dir,'cold.sqlite')],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assertRowsEqual(rows,JSON.parse(r.stdout),columns);
 const restore=spawnSync('python3',['scripts/storage-restore-part.py',join(dir,'part.gz'),join(dir,'independent.sqlite')],{encoding:'utf8'});assert.equal(restore.status,0,restore.stderr);assert.equal(JSON.parse(restore.stdout).fullFieldParity,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unsafe SQL scope and nonportable numbers fail closed',()=>{
 assert.notEqual(PRIMARY_DB,COLD_DB);
 assert.throws(()=>identifier('x; DROP TABLE y'),/IDENTIFIER/);
 assert.throws(()=>sqlValue(Infinity),/UNSAFE_NUMBER/);
 assert.throws(()=>sqlValue(2**60),/UNSAFE_NUMBER/);
 assert.throws(()=>sqlValue(undefined),/UNSUPPORTED_VALUE/);
 assert.throws(()=>rowSql('x',['id'],[{__source_rowid:'0;DELETE',id:'x'}]),/ROWID/);
 assert.throws(()=>assertRowsEqual([{id:'a',__source_rowid:'1'}],[{id:'b',__source_rowid:'1'}],['id']),/FIELD_PARITY/);
});
test('every generated statement stays below the D1 SQL length ceiling',()=>{
 const rows=Array.from({length:80},(_,i)=>({__source_rowid:String(i+1),id:String(i),payload:'é'.repeat(1000)}));
 const sql=rowSql('fixture',['id','payload'],rows);
 for(const statement of sql.trim().split('\n'))assert.ok(Buffer.byteLength(statement)<=90002);
});
