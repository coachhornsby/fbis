#!/usr/bin/env python3
"""Read existing R2 backup; never exports/writes production, R2 or remote D1.
Restores exact decompressed bytes into a new local SQLite file and reconciles
all source INSERT tuple counts with restored counts. Fail closed on unsupported
SQL grammar; retain evidence of legacy foreign key problems rather than hide it.
"""
import argparse,gzip,hashlib,json,os,pathlib,re,sqlite3,urllib.request
from collections import Counter

INSERT=re.compile(r'^INSERT INTO\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([^\s(]+))',re.I)
def tuple_count(sql):
 m=re.search(r'\bVALUES\s*',sql,re.I)
 if not m:raise ValueError('unsupported INSERT without VALUES')
 s=sql[m.end():];depth=0;quoted=False;n=0;i=0
 while i<len(s):
  c=s[i]
  if c=="'":
   if quoted and i+1<len(s) and s[i+1]=="'":i+=2;continue
   quoted=not quoted
  elif not quoted:
   if c=='(':
    if depth==0:n+=1
    depth+=1
   elif c==')':depth-=1
  i+=1
 if quoted or depth or n==0:raise ValueError('unsupported VALUES tuple syntax')
 return n

def verify(manifest,root,download=False,migrations=()):
 root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=True)
 if manifest['database_id']!='b50c724c-903b-4241-8ce1-48d931e7a44c':raise ValueError('wrong source')
 parts=manifest['parts'];names=[p['name'] for p in parts]
 if names!=['backup.part.'+str(i).zfill(4) for i in range(len(parts))]:raise ValueError('missing/duplicate/misordered part')
 account='2fdc80b8d99070adcef12f7a785c3fc1'
 if download and os.environ.get('CLOUDFLARE_ACCOUNT_ID')!=account:raise ValueError('wrong account')
 merged=root/'verified.sql.gz'
 archive_hash=hashlib.sha256();total=0
 with merged.open('wb') as out:
  for part in parts:
   path=root/part['name']
   if download:
    key=manifest['archive_prefix']+part['name']
    url=f'https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/fbis-archive/objects/{key}'
    req=urllib.request.Request(url,headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN']})
    with urllib.request.urlopen(req,timeout=180) as src,path.open('wb') as dest:
     while b:=src.read(1024*1024):dest.write(b)
   h=hashlib.sha256();size=0
   with path.open('rb') as f:
    while b:=f.read(1024*1024):h.update(b);archive_hash.update(b);out.write(b);size+=len(b);total+=len(b)
   if size!=part['bytes'] or h.hexdigest()!=part['sha256']:raise ValueError('part byte/hash mismatch '+part['name'])
   print('verified',part['name'],size,flush=True)
 if total!=manifest['archive_bytes'] or archive_hash.hexdigest()!=manifest['archive_sha256']:raise ValueError('archive mismatch')
 target=root/'independent-restore.sqlite'
 if target.exists():raise ValueError('restore target already exists')
 c=sqlite3.connect(target);c.execute('PRAGMA foreign_keys=OFF')
 expected=Counter();raw_sha=hashlib.sha256();raw_bytes=0;buffer='';statements=0
 # Source read is bounded per statement; a giant unsupported statement stops.
 try:
  with gzip.open(merged,'rb') as f:
   for line in f:
    raw_sha.update(line);raw_bytes+=len(line);buffer+=line.decode('utf-8')
    if len(buffer)>2_000_000:raise ValueError('oversized source statement')
    if not sqlite3.complete_statement(buffer):continue
    statement=buffer.strip();buffer=''
    # Strip comment lines before classifying (SQL dump comments are line-leading).
    while statement.startswith('--'):
     _,_,statement=statement.partition('\n')
     statement=statement.lstrip()
    if not statement:continue
    m=INSERT.match(statement)
    if m:
     table=next(v for v in m.groups() if v is not None);expected[table]+=tuple_count(statement)
    elif re.match(r'INSERT|REPLACE|UPDATE|DELETE',statement,re.I):
     if not re.match(r'DELETE FROM ["`\[]?sqlite_sequence',statement,re.I):raise ValueError('unhandled mutating dump statement')
    c.execute(statement);statements+=1
    if statements%100000==0:print('restored statements',statements,flush=True)
  if buffer.strip():raise ValueError('truncated source SQL')
  if raw_bytes!=manifest['source_sql_bytes'] or raw_sha.hexdigest()!=manifest['sql_sha256']:raise ValueError('full SQL checksum mismatch')
  c.commit()
  integrity=[r[0] for r in c.execute('PRAGMA integrity_check')]
  if integrity!=['ok']:raise ValueError('integrity failure')
  schema=[dict(zip(['type','name','table','sql'],r)) for r in c.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")]
  counts={r[0]:c.execute('SELECT COUNT(*) FROM "'+r[0].replace('"','""')+'"').fetchone()[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
  mismatches={t:{'source':expected.get(t,0),'restored':n} for t,n in counts.items() if n!=expected.get(t,0)}
  if mismatches:raise ValueError('source row reconciliation mismatch '+json.dumps(mismatches))
  fk=c.execute('PRAGMA foreign_key_check').fetchall()
  ledger={t:list(c.execute('SELECT * FROM '+t)) for t in ['schema_migrations','d1_migrations']}
  before_counts=dict(counts);before_schema=schema
  for migration in migrations:
   sql=pathlib.Path(migration).read_text();c.executescript(sql);c.executescript(sql)
  preserved=all(c.execute('SELECT COUNT(*) FROM "'+t.replace('"','""')+'"').fetchone()[0]==n for t,n in before_counts.items() if t not in ['schema_migrations','d1_migrations','sqlite_sequence'])
  after_integrity=[r[0] for r in c.execute('PRAGMA integrity_check')]
  report={'status':'VERIFIED_LOCAL_FULL_RESTORE' if not fk and preserved and after_integrity==['ok'] else 'BLOCKED_RECONCILIATION',
   'source_database':manifest['database_id'],'bookmark':manifest['bookmark'],'parts':parts,
   'archive_sha256':archive_hash.hexdigest(),'sql_sha256':raw_sha.hexdigest(),'sql_bytes':raw_bytes,
   'source_statement_count':statements,'source_tuple_counts':dict(expected),'restored_table_counts':counts,
   'schema':before_schema,'migration_ledgers_before':ledger,'foreign_key_violation_count':len(fk),
   'foreign_key_violations_sample':fk[:50],'integrity':integrity,'migration_preservation':preserved if migrations else None,'rehearsed_migrations':[str(p) for p in migrations],
   'postmigration_integrity':after_integrity if migrations else None,'production_mutations':0,
   'remote_d1_full_restore_verified':False,'source_export_created_at':None,
   'limitations':['SQLite full restore; remote D1 import not exercised','Original 603-part export not located; verified newer single-bookmark compressed archive instead']}
  (root/'independent-reconciliation.json').write_text(json.dumps(report,indent=2)+'\n')
  print(report['status'],len(counts),'tables',flush=True)
 finally:c.close()
 return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--manifest',required=True);p.add_argument('--root',required=True);p.add_argument('--download',action='store_true');p.add_argument('--migration',action='append',default=[]);a=p.parse_args()
 verify(json.loads(pathlib.Path(a.manifest).read_text()),a.root,a.download,a.migration)
