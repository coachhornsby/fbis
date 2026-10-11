#!/usr/bin/env python3
"""Existing-bookmark recovery drill: locally qualified SQL -> fresh isolated D1.
No production export, production writes, migrations, model or wagering authority.
"""
import argparse,gzip,hashlib,importlib.util,json,os,pathlib,re,shutil,sqlite3,time,urllib.request
from collections import Counter
ROOT=pathlib.Path(__file__).resolve().parent
PRODUCTION='b50c724c-903b-4241-8ce1-48d931e7a44c'
FORBIDDEN={PRODUCTION,'1142b60c-6e00-4286-87b8-4edff9de3129'}
ACCOUNT='2fdc80b8d99070adcef12f7a785c3fc1'
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
backup=module('backup','cfb-existing-backup-verify.py');dependency=module('dependency','cfb-d1-dependency-plan.py')
def save(path,obj):path.write_text(json.dumps(obj,indent=2)+'\n')
def quote(name):return '"'+name.replace('"','""')+'"'
def statements(path):
 opener=gzip.open if str(path).endswith('.gz') else open;buffer=''
 with opener(path,'rt',encoding='utf-8',newline='') as stream:
  for line in stream:
   buffer+=line
   if len(buffer.encode())>2_000_000:raise ValueError('Source statement exceeds accepted bound')
   if not sqlite3.complete_statement(buffer):continue
   s=buffer.strip();buffer=''
   while s.startswith('--'):s=s.partition('\n')[2].lstrip()
   if s:yield s
 if buffer.strip():raise ValueError('Truncated SQL')
def schemas(db):return [dict(zip(['type','name','table','sql'],r)) for r in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")]
def counts(db):return {r[0]:db.execute('SELECT COUNT(*) FROM '+quote(r[0])).fetchone()[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
def stage(source,report,destination,max_bytes=64*1024*1024):
 if not 1024<=max_bytes<=100*1024*1024:raise ValueError('Invalid part size')
 if report.get('status')!='VERIFIED_LOCAL_FULL_RESTORE' or report.get('foreign_key_violation_count')!=0:raise ValueError('Verified source recovery required')
 order=dependency.plan(report)['table_import_order'];root=pathlib.Path(destination)
 if root.exists():raise ValueError('Fresh staging directory required')
 root.mkdir();spool=root/'spool';spool.mkdir();handles={};paths={};rows=Counter();n=0;suppressed=[]
 def append(group,s):
  if group not in handles:
   paths[group]=spool/f'{len(paths):04d}.sql';handles[group]=paths[group].open('w',encoding='utf-8')
  handles[group].write(s+'\n')
 try:
  for s in statements(source):
   n+=1;m=backup.INSERT.match(s)
   if m:
    table=next(v for v in m.groups() if v is not None)
    if table not in order:raise ValueError('Unexpected source table '+table)
    rows[table]+=backup.tuple_count(s);append(table,s)
   elif re.match(r'^CREATE\s+TABLE\b',s,re.I):append('TABLE_DDL',s)
   elif re.match(r'^CREATE\s+(UNIQUE\s+)?INDEX\b',s,re.I):append('INDEX_DDL',s)
   elif re.match(r'^CREATE\s+(VIEW|TRIGGER)\b',s,re.I):append('POST_DDL',s)
   elif re.fullmatch(r'PRAGMA\s+(foreign_keys|defer_foreign_keys)\s*=\s*(ON|OFF|TRUE|FALSE|0|1)\s*;',s,re.I):suppressed.append(s)
   elif re.fullmatch(r'DELETE\s+FROM\s+["`\[]?sqlite_sequence["`\]]?\s*;',s,re.I):append('SEQUENCE_RESET',s)
   else:raise ValueError('Unsupported source statement class: '+s[:80])
 finally:
  for h in handles.values():h.close()
 if n!=report['source_statement_count']:raise ValueError('Source statement accounting mismatch')
 if any(rows.get(t,0)!=c for t,c in report['restored_table_counts'].items()):raise ValueError('Staged row-count mismatch')
 # Hash raw decompressed source independently; staged reordering never changes a bookmark.
 digest=hashlib.sha256();total=0;opener=gzip.open if str(source).endswith('.gz') else open
 with opener(source,'rb') as stream:
  while b:=stream.read(1024*1024):digest.update(b);total+=len(b)
 if digest.hexdigest()!=report['sql_sha256'] or total!=report['sql_bytes']:raise ValueError('Source byte/hash mismatch')
 groups=['TABLE_DDL','INDEX_DDL']+[t for t in order if t!='sqlite_sequence']+['SEQUENCE_RESET','sqlite_sequence','POST_DDL']
 parts=[];staged=0
 for group in groups:
  if group not in paths:continue
  current=bytearray();part_statements=0
  def flush():
   nonlocal part_statements,staged
   if not current:return
   data=bytes(current);name=f'import-{len(parts):04d}.sql';(root/name).write_bytes(data)
   parts.append({'name':name,'group':group,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'etag':hashlib.md5(data).hexdigest(),'statements':part_statements})
   staged+=part_statements;current.clear();part_statements=0
  for s in statements(paths[group]):
   data=(s+'\n').encode()
   if len(data)>max_bytes:raise ValueError('Statement cannot fit import part')
   if len(current)+len(data)>max_bytes:flush()
   current.extend(data);part_statements+=1
  flush();paths[group].unlink()
 if staged+len(suppressed)!=n:raise ValueError('Silent statement omission detected')
 result={'status':'STAGED_UNQUALIFIED','source_database':report['source_database'],'bookmark':report['bookmark'],
  'source_sql_sha256':digest.hexdigest(),'source_sql_bytes':total,'source_statements':n,'staged_statements':staged,
  'explicitly_suppressed_source_pragmas':suppressed,'parts':parts,'table_counts':report['restored_table_counts'],
  'remote_d1_restore_verified':False,'production_mutations':0}
 save(root/'import-manifest.json',result)
 # Spools are redundant local staging files. Retain final hash-verified parts.
 shutil.rmtree(spool)
 return result

def rehearse(root,manifest,report):
 root=pathlib.Path(root);path=root/'transaction-rehearsal.sqlite'
 if path.exists():raise ValueError('Fresh local rehearsal required')
 db=sqlite3.connect(path);db.execute('PRAGMA foreign_keys=ON')
 try:
  for p in manifest['parts']:
   data=(root/p['name']).read_bytes()
   if hashlib.sha256(data).hexdigest()!=p['sha256'] or len(data)!=p['bytes']:raise ValueError('Part checksum mismatch')
   db.executescript('BEGIN;\n'+data.decode()+'\nCOMMIT;')
   if db.execute('PRAGMA foreign_key_check').fetchone():raise ValueError('Cross-file foreign-key violation')
  if counts(db)!=report['restored_table_counts']:raise ValueError('Full table-count reconciliation failed')
  actual_schema=schemas(db)
  if actual_schema!=report['schema']:
   save(root/'schema-reconciliation.json',{'status':'MISMATCH','actual_only':[r for r in actual_schema if r not in report['schema']],'expected_only':[r for r in report['schema'] if r not in actual_schema]})
   raise ValueError('Exact schema reconciliation failed')
  if [r[0] for r in db.execute('PRAGMA integrity_check')]!=['ok']:raise ValueError('Integrity failure')
  for t,expected in report['migration_ledgers_before'].items():
   if [list(r) for r in db.execute('SELECT * FROM '+quote(t))]!=[list(r) for r in expected]:raise ValueError('Migration ledger mismatch')
  for t,expected in report.get('table_content_digests',{}).items():
   if content_digest(db,t)!=expected:raise ValueError('Local complete content mismatch: '+t)
  manifest['status']='VERIFIED_LOCAL_FK_ENFORCED_PARTS';manifest['local_transaction_integrity']=['ok'];save(root/'import-manifest.json',manifest)
 finally:db.close()
 return manifest

def cursor_column(columns):
 for c in ('rowid','_rowid_','oid'):
  if c not in columns:return quote(c)
 raise ValueError('No unshadowed rowid available')
def value_expression(c):
 q=quote(c)
 return "CASE typeof("+q+") WHEN 'text' THEN 'text:'||hex("+q+") WHEN 'blob' THEN 'blob:'||hex("+q+") WHEN 'real' THEN 'real:'||printf('%!.26g',"+q+") ELSE typeof("+q+")||':'||quote("+q+") END"
def content_digest(db,table):
 columns=[r[1] for r in db.execute('PRAGMA table_info('+quote(table)+')')]
 if not columns:raise ValueError('Missing table columns')
 expression=','.join(value_expression(c) for c in columns)
 digest=hashlib.sha256();n=0
 for row in db.execute('SELECT '+expression+' FROM '+quote(table)+' ORDER BY '+cursor_column(columns)):
  digest.update((json.dumps(list(row),ensure_ascii=True,separators=(',',':'))+'\n').encode());n+=1
 return {'rows':n,'sha256':digest.hexdigest(),'columns':columns,'algorithm':'SHA256 typed lossless SQLite values / ordered JSON rows / newline'}

def target_guard(target,name):
 if target in FORBIDDEN or not re.fullmatch(r'fbis-cfb-full-recovery-20261011-[0-9]+',name):raise ValueError('Nonproduction target contract rejected')
 if not re.fullmatch(r'[a-f0-9-]{36}',target):raise ValueError('Invalid target UUID')

class Remote:
 def __init__(self,journal):
  if os.environ.get('CLOUDFLARE_ACCOUNT_ID')!=ACCOUNT:raise ValueError('Wrong Cloudflare account')
  self.token=os.environ['CLOUDFLARE_API_TOKEN'];self.path=pathlib.Path(journal);self.journal={'status':'NOT_STARTED','production_mutations':0,'imports':[]};self.target=None;self.name=None
 def api(self,method,path,body=None):
  # Only creation of a new isolated target and calls to that target are allowed.
  if self.target:target_guard(self.target,self.name)
  if path=='/d1/database' and (method!='POST' or body!={'name':self.name} or not re.fullmatch(r'fbis-cfb-full-recovery-20261011-[0-9]+',self.name or '')):raise ValueError('Fresh target creation contract rejected')
  if path!='/d1/database' and (not self.target or not path.startswith('/d1/database/'+self.target+'/')):raise ValueError('Unapproved API scope')
  req=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=90) as r:d=json.load(r)
  if not d.get('success'):raise RuntimeError('Cloudflare API operation failed; retain journal')
  return d['result']
 def query(self,sql):
  if not (sql.startswith('SELECT ') or sql=='PRAGMA foreign_key_check'):raise ValueError('Read-only reconciliation query required')
  results=self.api('POST','/d1/database/'+self.target+'/query',{'sql':sql})
  if any(not r.get('success') for r in results):raise RuntimeError('Isolated reconciliation query failed')
  return results[0]['results']
 def execute(self,root,manifest,report,run_id):
  if manifest['status']!='VERIFIED_LOCAL_FK_ENFORCED_PARTS':raise ValueError('Local transaction acceptance required')
  if self.path.exists():raise ValueError('Existing journal requires explicit operator resume; no automatic replay')
  self.name='fbis-cfb-full-recovery-20261011-'+str(run_id)
  if not re.fullmatch(r'[0-9]+',str(run_id)):raise ValueError('Numeric unique run ID required')
  self.journal.update(status='CREATING_FRESH_TARGET',name=self.name,source_bookmark=manifest['bookmark']);save(self.path,self.journal)
  target=self.api('POST','/d1/database',{'name':self.name})
  self.target=target['uuid'];target_guard(self.target,self.name);self.journal['target']=self.target;save(self.path,self.journal)
  if self.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\';"):raise ValueError('Target not empty')
  for part in manifest['parts']:
   data=(pathlib.Path(root)/part['name']).read_bytes()
   if len(data)!=part['bytes'] or hashlib.sha256(data).hexdigest()!=part['sha256']:raise ValueError('Import checksum mismatch')
   entry={'name':part['name'],'sha256':part['sha256'],'status':'INIT'};self.journal['imports'].append(entry);save(self.path,self.journal)
   path='/d1/database/'+self.target+'/import';init=self.api('POST',path,{'action':'init','etag':part['etag']})
   if init.get('upload_url'):
    req=urllib.request.Request(init['upload_url'],data=data,method='PUT',headers={'Content-Type':'application/sql'})
    try:
     with urllib.request.urlopen(req,timeout=180) as uploaded:
      if not 200<=uploaded.status<300:raise RuntimeError('Isolated upload rejected')
    except Exception:raise RuntimeError('Isolated upload failed; private URL omitted; retain journal') from None
   entry['status']='INGESTING';save(self.path,self.journal)
   result=self.api('POST',path,{'action':'ingest','etag':part['etag'],'filename':init['filename']});deadline=time.monotonic()+1800
   while result.get('status')=='active':
    entry['bookmark']=result['at_bookmark'];save(self.path,self.journal)
    if time.monotonic()>deadline:raise TimeoutError('Import poll bound reached; do not replay ingest')
    time.sleep(5);result=self.api('POST',path,{'action':'poll','current_bookmark':result['at_bookmark']})
   if result.get('status')!='complete':raise RuntimeError('Isolated import failed; retain target/journal')
   entry.update(status='COMPLETE',result=result.get('result'));save(self.path,self.journal);print('completed isolated part',part['name'],flush=True)
  self.journal['status']='RECONCILING';save(self.path,self.journal)
  actual={}
  for name in report['restored_table_counts']:
   actual[name]=self.query('SELECT COUNT(*) AS n FROM '+quote(name))[0]['n']
  if actual!=report['restored_table_counts']:raise ValueError('Remote complete-count mismatch')
  schema=self.query("SELECT type,name,tbl_name AS 'table',sql FROM sqlite_master ORDER BY type,name")
  internal=[r for r in schema if r['table']=='_cf_KV'];self.journal['allowed_cloudflare_internal_schema']=internal
  schema=[r for r in schema if r['table']!='_cf_KV']
  if schema!=report['schema']:raise ValueError('Remote schema mismatch')
  if self.query('PRAGMA foreign_key_check'):raise ValueError('Remote foreign-key violation')
  ledgers={t:self.query('SELECT * FROM '+quote(t)) for t in report['migration_ledgers_before']}
  for table,expected in report['table_content_digests'].items():
   expression=','.join(value_expression(c)+' AS '+quote(c) for c in expected['columns']);digest=hashlib.sha256();n=0;cursor=None
   rowid=cursor_column(expected['columns'])
   if '__recovery_cursor' in expected['columns']:raise ValueError('Reserved recovery cursor column collision')
   while True:
    where='' if cursor is None else ' WHERE '+rowid+'>'+str(cursor)
    rows=self.query('SELECT CAST('+rowid+' AS TEXT) AS __recovery_cursor,'+expression+' FROM '+quote(table)+where+' ORDER BY '+rowid+' LIMIT 500')
    if not rows:break
    for row in rows:
     digest.update((json.dumps([row[c] for c in expected['columns']],ensure_ascii=True,separators=(',',':'))+'\n').encode());n+=1
    next_cursor=int(rows[-1]['__recovery_cursor'])
    if cursor is not None and next_cursor<=cursor:raise ValueError('Nonadvancing reconciliation cursor')
    cursor=next_cursor
   if {'rows':n,'sha256':digest.hexdigest()}!={k:expected[k] for k in ('rows','sha256')}:raise ValueError('Complete remote content mismatch: '+table)
   self.journal.setdefault('verified_table_content',{})[table]={'rows':n,'sha256':digest.hexdigest()};save(self.path,self.journal)
  for table,expected in report['migration_ledgers_before'].items():
   if [[r[c] for c in report['table_content_digests'][table]['columns']] for r in ledgers[table]]!=[list(r) for r in expected]:raise ValueError('Remote migration ledger mismatch')
  self.journal.update(status='VERIFIED_REMOTE_FULL_RESTORE_PENDING_INDEPENDENT_REVIEW' ,table_counts=actual,schema=schema,migration_ledgers=ledgers,
   remote_d1_full_restore_verified=True,limitations=['Independent verifier acceptance and unknown original export creation time remain separate production gates.'],complete_content_reconciliation=True)
  save(self.path,self.journal);return self.journal

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--manifest',required=True);parser.add_argument('--root',required=True);parser.add_argument('--remote-run-id')
 a=parser.parse_args();root=pathlib.Path(a.root)
 if root.exists():raise ValueError('Fresh full drill directory required')
 if shutil.disk_usage(root.parent).free<18*1024**3:raise ValueError('Insufficient scratch disk for full-data rehearsal')
 manifest=json.loads(pathlib.Path(a.manifest).read_text());report=backup.verify(manifest,root,download=True)
 if report['status']!='VERIFIED_LOCAL_FULL_RESTORE':raise ValueError('Source recovery failed acceptance')
 db=sqlite3.connect(root/'independent-restore.sqlite');report['table_content_digests']={t:content_digest(db,t) for t in report['restored_table_counts']};db.close();save(root/'independent-reconciliation.json',report)
 # Only verified, reproducible local copies are removed; original R2 archive is retained.
 (root/'independent-restore.sqlite').unlink()
 for part in manifest['parts']:(root/part['name']).unlink()
 staged=stage(root/'verified.sql.gz',report,root/'parts');rehearse(root/'parts',staged,report)
 if a.remote_run_id:Remote(root/'remote-journal.json').execute(root/'parts',staged,report,a.remote_run_id)
