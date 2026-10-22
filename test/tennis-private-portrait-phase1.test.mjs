import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const sql=readFileSync(new URL('../migrations/0119_tennis_private_portrait_phase1.sql',import.meta.url),'utf8');
const python=String.raw`
import sqlite3,sys
c=sqlite3.connect(':memory:')
c.executescript("""
PRAGMA foreign_keys=ON;
CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT);
CREATE TABLE tennis_abstract_elo_runs(tour TEXT,report_date TEXT,source_hash TEXT,source_url TEXT,player_count INTEGER,retrieved_at TEXT,research_only INTEGER,can_authorize_wager INTEGER);
CREATE TABLE tennis_abstract_elo_players(tour TEXT,report_date TEXT,source_hash TEXT,player_key TEXT,player_name TEXT,elo_rank INTEGER);
CREATE TABLE tennis_players(fbis_player_id TEXT PRIMARY KEY,tour TEXT,normalized_name TEXT);
CREATE TABLE tennis_player_portraits(fbis_player_id TEXT,source_name TEXT,display_scope TEXT,public_display_allowed INTEGER,approval_status TEXT);
""")
cohort='tennis-elo-private-20261019-1074'
rows=[('atp',559,'8e17d8cc26cc96bbf9d03f506adf788d6c172ff310a50583d6da39d7c0dc26f1'),
      ('wta',515,'ffe2e714a810da20a0f2107f14b85d87e52de50101d4bf931e3e53970d796c6b')]
for tour,n,h in rows:
 c.execute('INSERT INTO tennis_abstract_elo_runs VALUES (?,?,?,?,?,?,?,?)',(tour,'2026-10-19',h,'https://www.tennisabstract.com/reports/'+tour+'_elo_ratings.html',n,'2026-10-21T20:41:00Z',1,0))
 c.executemany('INSERT INTO tennis_abstract_elo_players VALUES (?,?,?,?,?,?)',
 [(tour,'2026-10-19',h,tour+' testplayer '+str(i),tour.upper()+' Testplayer '+str(i),i+1) for i in range(n)])
 c.execute('INSERT INTO tennis_players VALUES (?,?,?)',(tour+':id0',tour,tour+' testplayer 0'))
c.executescript(sys.stdin.read())
assert c.execute('SELECT COUNT(*) FROM tennis_private_portrait_cohort_members').fetchone()[0]==1074
assert c.execute("SELECT COUNT(*) FROM tennis_private_portrait_cohort_members WHERE tour='atp'").fetchone()[0]==559
assert c.execute("SELECT COUNT(*) FROM tennis_private_portrait_cohort_members WHERE tour='wta'").fetchone()[0]==515
assert c.execute("SELECT COUNT(*) FROM tennis_private_portrait_cohort_members WHERE identity_status='MATCHED'").fetchone()[0]==2
assert c.execute("SELECT COUNT(*) FROM tennis_private_portrait_policy WHERE activation_state='BLOCKED' AND rights_evidence_ref IS NULL AND display_scope='PRIVATE_ONLY' AND public_display_allowed=0").fetchone()[0]==2
def blocked(query):
 try: c.execute(query)
 except sqlite3.IntegrityError: return
 raise AssertionError('Expected database policy to block: '+query)
blocked("INSERT INTO tennis_player_portraits VALUES ('atp:id0','ATP_OFFICIAL','PUBLIC_WEB',1,'PENDING')")
blocked("INSERT INTO tennis_player_portraits VALUES ('atp:id0','ATP_OFFICIAL','PRIVATE_ONLY',0,'APPROVED')")
blocked("UPDATE tennis_private_portrait_cohort_members SET player_key='altered' WHERE cohort_id='"+cohort+"' AND tour='atp' AND player_key='atp testplayer 0'")
blocked("DELETE FROM tennis_private_portrait_cohort_members WHERE cohort_id='"+cohort+"' AND tour='atp'")
c.execute("INSERT INTO tennis_player_portraits VALUES ('atp:id0','ATP_OFFICIAL','PRIVATE_ONLY',0,'PENDING')")
assert c.execute("SELECT COUNT(*) FROM tennis_player_portraits WHERE source_name='ATP_OFFICIAL' AND approval_status='PENDING'").fetchone()[0]==1
print('PHASE1_SQLITE_CONTRACT_OK total=1074 approvedRestricted=0 policiesBlocked=2')
`;
test('Phase 1 freezes exactly 559 ATP + 515 WTA and denies public/private-unverified headshots',()=>{
 assert.match(sql,/8e17d8cc26cc96bbf9d03f506adf788d6c172ff310a50583d6da39d7c0dc26f1/);
 assert.equal((sql.match(/r\.source_hash='[a-f0-9]{64}'/g)||[]).length,2);
 const run=spawnSync('python3',['-c',python],{input:sql,encoding:'utf8',timeout:15000});
 assert.equal(run.status,0,run.stderr||run.stdout);
 assert.match(run.stdout,/PHASE1_SQLITE_CONTRACT_OK/);
});
test('Official portraits cannot be made public through the existing public image gate',()=>{
 const gate=readFileSync(new URL('../functions/lib/tennisPortraits.js',import.meta.url),'utf8');
 assert.match(gate,/row.display_scope !== "PUBLIC_WEB"/);
 assert.match(gate,/Number\(row.public_display_allowed\) !== 1/);
 const raw=readFileSync(new URL('../functions/api/tennis-private-portrait-phase1.js',import.meta.url),'utf8');
 assert.match(raw,/authorizeHarvest\(request,env\)/);
 assert.doesNotMatch(raw,/rawImageBytes|dataBase64|assetUrl/);
});
