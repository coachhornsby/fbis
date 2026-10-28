#!/usr/bin/env python3
"""Restore the archived PRIMARY CFB tables into a new local SQLite database."""
import sys,pathlib,gzip,sqlite3,json,hashlib
root=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2]);assert not target.exists()
manifest=json.loads((root/'manifest.json').read_text());expected=json.loads((root/'parity.json').read_text())
for name,ref in manifest['files'].items():
 h=hashlib.sha256();size=0
 with (root/name).open('rb') as f:
  while b:=f.read(1024*1024):h.update(b);size+=len(b)
 assert size==ref['bytes'] and h.hexdigest()==ref['sha256'],name
c=sqlite3.connect(target);c.execute('PRAGMA journal_mode=OFF');c.execute('PRAGMA synchronous=OFF');c.execute('BEGIN')
statement='';sqlhash=hashlib.sha256()
with gzip.open(root/'primary.sql.gz','rt',encoding='utf-8',newline='') as f:
 for line in f:
  sqlhash.update(line.encode('utf-8'));statement+=line
  if sqlite3.complete_statement(statement):c.execute(statement);statement=''
assert not statement.strip();c.commit();c.executescript((root/'schema-post.sql').read_text());assert sqlhash.hexdigest()==manifest['sqlSha256']
schema=[list(r) for r in c.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name")];assert schema==manifest['schema']
report={'tables':{},'rows':0,'integrity':c.execute('PRAGMA integrity_check').fetchone()[0],'foreignKeyErrors':len(c.execute('PRAGMA foreign_key_check').fetchall())}
assert report['integrity']=='ok' and report['foreignKeyErrors']==0
for table,key in [('cfb_canonical_players','player_id'),('cfb_roster_membership','id')]:
 ref=expected['tables'][table];cols=[r[1] for r in c.execute('PRAGMA table_info('+table+')')];assert cols==ref['columns']
 digest=hashlib.sha256();n=0
 for row in c.execute('SELECT '+','.join('"'+x+'"' for x in cols)+' FROM '+table+' ORDER BY '+key):
  data=json.dumps(row,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode();digest.update(len(data).to_bytes(8,'big'));digest.update(data);n+=1
 assert n==ref['rows'] and digest.hexdigest()==ref['sha256'];report['tables'][table]={'rows':n,'sha256':digest.hexdigest(),'allFieldsVerified':True};report['rows']+=n
c.close();print(json.dumps(report,indent=2))
