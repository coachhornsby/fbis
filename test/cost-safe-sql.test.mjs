import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {archivePageSql,changedOnlyUpsertSql} from '../functions/lib/costSafeSql.js';
test('SQLite seeks archive cursor; missing index blocks execution; replay writes only changed records',()=>{
 const input={archive:archivePageSql(['id','collected_at']),upsert:changedOnlyUpsertSql('copy',['id','value'],['id']),composite:changedOnlyUpsertSql('multi',['season','source','value'],['season','source']),rowid:changedOnlyUpsertSql('no_pk',['value'],['rowid'],{rowid:true})};
 const py=`import sqlite3,json,sys
p=json.load(sys.stdin); c=sqlite3.connect(':memory:')
c.execute('CREATE TABLE normalized_market_observations(id TEXT PRIMARY KEY,collected_at TEXT)')
try: c.execute(p['archive'],('z','','',10)); raise AssertionError('missing index permitted')
except sqlite3.OperationalError as e: assert 'no such index' in str(e)
c.executemany('INSERT INTO normalized_market_observations VALUES(?,?)',[(str(i).zfill(8),'2026-10-01') for i in range(100000)])
c.execute('CREATE INDEX idx_market_archive_cursor ON normalized_market_observations(collected_at,id)')
plan=c.execute('EXPLAIN QUERY PLAN '+p['archive'],('2026-10-02','2026-10-01','00099989',10)).fetchall()
assert any('SEARCH' in r[3] and 'idx_market_archive_cursor' in r[3] for r in plan),plan
assert not any('TEMP B-TREE' in r[3] for r in plan),plan
calls=[0]
def progress(): calls[0]+=1; return 0
c.set_progress_handler(progress,1)
rows=c.execute(p['archive'],('2026-10-02','2026-10-01','00099989',10)).fetchall()
c.set_progress_handler(None,0)
assert len(rows)==10 and calls[0]<1000,(len(rows),calls)
c.execute('CREATE TABLE copy(id TEXT PRIMARY KEY,value TEXT)')
c.execute(p['upsert'],('x',None)); n=c.total_changes
for _ in range(1000): c.execute(p['upsert'],('x',None))
assert c.total_changes==n
c.execute(p['upsert'],('x','new')); assert c.total_changes==n+1
assert c.execute('SELECT value FROM copy').fetchone()[0]=='new'
c.execute('CREATE TABLE multi(season INTEGER,source TEXT,value TEXT,PRIMARY KEY(season,source))')
c.execute(p['composite'],(2026,'official','a'));n=c.total_changes
c.execute(p['composite'],(2026,'official','a'));assert c.total_changes==n
c.execute('CREATE TABLE no_pk(value TEXT)')
c.execute(p['rowid'],(1,'a'));n=c.total_changes
c.execute(p['rowid'],(1,'a'));assert c.total_changes==n
print(json.dumps({'archivePlan':plan,'archiveVmSteps':calls[0],'fixtureRows':100000,'unchangedReplays':1000,'unchangedWrites':0,'changedUpdatesPreserved':True,'compositeAndRowid':True}))`;
 const r=spawnSync('python',['-c',py],{input:JSON.stringify(input),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);console.log(r.stdout.trim());
});
test('SQL identifiers reject injection',()=>{assert.throws(()=>archivePageSql(['id;DROP TABLE x']));assert.throws(()=>changedOnlyUpsertSql('bad-name',['id'],['id']));});
