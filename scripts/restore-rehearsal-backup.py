#!/usr/bin/env python3
"""Restore the immutable rehearsal backup, including original SQLite rowids."""
import sys,sqlite3,gzip,json,pathlib,hashlib,re
root=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2])
assert not target.exists(),'Restore target must be new'
metadata=json.loads((root/'source-metadata.json').read_text())
rowids=json.loads(gzip.decompress((root/'source-rowids.json.gz').read_bytes()))
sql=gzip.decompress((root/'source.sql.gz').read_bytes())
c=sqlite3.connect(target);c.executescript('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; BEGIN;\n'+sql.decode('utf-8')+'\nCOMMIT;')
actual_schema=[dict(zip(('type','name','tbl_name','sql'),r)) for r in c.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name")]
norm=lambda s:re.sub(r'\s+',' ',s.rstrip(';').strip()) if s else s
assert [(r['type'],r['name'],r['tbl_name'],norm(r['sql'])) for r in actual_schema]==[(r['type'],r['name'],r['tbl_name'],norm(r['sql'])) for r in metadata['schema']],'Schema mismatch'
report={'sqlSha256':hashlib.sha256(sql).hexdigest(),'tables':{},'rows':0,'schemaObjects':len(actual_schema)}
for table,v in rowids.items():
 assert re.fullmatch('[a-zA-Z0-9_]+',table) and re.fullmatch('[a-zA-Z0-9_]+',v['key'])
 expected=metadata['counts'][table];assert len(v['rows'])==expected['n']
 assert c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]==expected['n']
 # Export SQL preserves fields; this sidecar restores the source rowid gaps.
 c.execute(f'UPDATE "{table}" SET rowid=-rowid')
 for r in v['rows']:
  assert r['original_rowid']>0
  assert c.execute(f'UPDATE "{table}" SET rowid=? WHERE "{v["key"]}"=?',(r['original_rowid'],r['stable_key'])).rowcount==1
 c.commit()
 assert c.execute(f'SELECT rowid,"{v["key"]}" FROM "{table}" ORDER BY rowid').fetchall()==[(r['original_rowid'],r['stable_key']) for r in v['rows']]
 digest=hashlib.sha256()
 for row in c.execute(f'SELECT rowid,* FROM "{table}" ORDER BY rowid'):
  data=json.dumps(row,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode();digest.update(len(data).to_bytes(8,'big'));digest.update(data)
 report['tables'][table]={'rows':expected['n'],'originalRowidsPreserved':True,'fullRecordSha256':digest.hexdigest()};report['rows']+=expected['n']
assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert not c.execute('PRAGMA foreign_key_check').fetchall()
report.update(integrity='ok',foreignKeyErrors=0)
c.close();print(json.dumps(report,indent=2))
