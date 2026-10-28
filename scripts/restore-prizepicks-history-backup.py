#!/usr/bin/env python3
import sys,sqlite3,pathlib,gzip,json,hashlib
root=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2]);assert not target.exists()
compressed=root/'source.sql.gz';source=gzip.open(compressed,'rt',encoding='utf-8',newline='') if compressed.exists() else (root/'source.sql').open(encoding='utf-8',newline='')
c=sqlite3.connect(target);c.execute('PRAGMA journal_mode=OFF');c.execute('PRAGMA synchronous=OFF');c.execute('BEGIN');statement='';sqlhash=hashlib.sha256()
with source as f:
 for line in f:
  sqlhash.update(line.encode());statement+=line
  if sqlite3.complete_statement(statement):c.execute(statement);statement=''
assert not statement.strip();c.commit()
if (root/'schema-post.sql').exists():c.executescript((root/'schema-post.sql').read_text())
assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert not c.execute('PRAGMA foreign_key_check').fetchall()
columns=[r[1] for r in c.execute('PRAGMA table_info(prizepicks_prop_lines)')];full=hashlib.sha256();typed=hashlib.sha256();n=0;rawbytes=0
for row in c.execute('SELECT * FROM prizepicks_prop_lines ORDER BY id'):
 encoded=json.dumps(row,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode();full.update(len(encoded).to_bytes(8,'big'));full.update(encoded)
 view=[v for k,v in zip(columns,row) if k!='raw_json'];encoded=json.dumps(view,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode();typed.update(len(encoded).to_bytes(8,'big'));typed.update(encoded)
 n+=1;rawbytes+=len(row[columns.index('raw_json')].encode())
schema=[list(r) for r in c.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name")]
report={'rows':n,'columns':columns,'fullRecordSha256':full.hexdigest(),'typedFieldsSha256':typed.hexdigest(),'rawBytes':rawbytes,'sqlSha256':sqlhash.hexdigest(),'schema':schema,'integrity':'ok','foreignKeyErrors':0}
if (root/'verification-original.json').exists() and (root/'verification-original.json').stat().st_size:assert report==json.loads((root/'verification-original.json').read_text()),'Restored fields, counts or schema differ'
print(json.dumps(report,indent=2));c.close()
