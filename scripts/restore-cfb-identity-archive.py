"""Restore the verified CFB identity archive into a NEW local SQLite database."""
import argparse,gzip,hashlib,json,pathlib,sqlite3,zipfile
TABLES=('cfb_player_aliases','cfb_player_provider_ids','cfb_roster_observations')
def restore(archive,destination,expected_sha):
 archive=pathlib.Path(archive);destination=pathlib.Path(destination)
 if destination.exists():raise ValueError('DESTINATION_EXISTS')
 if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected_sha:raise ValueError('ARCHIVE_SHA256_MISMATCH')
 with zipfile.ZipFile(archive) as z:
  report=json.loads(z.read('verification.json'));db=sqlite3.connect(destination)
  try:
   for table in TABLES:
    receipt=json.loads(z.read('primary-'+table+'.receipt.json'))
    packed=z.read('primary-'+table+'.ndjson.gz')
    if hashlib.sha256(packed).hexdigest()!=receipt['gzipSha256']:raise ValueError('PART_SHA256_MISMATCH')
    stream_hash=hashlib.sha256();n=0;cursor=0;end=None
    import io
    with gzip.GzipFile(fileobj=io.BytesIO(packed)) as f:
     first=f.readline();stream_hash.update(first);meta=json.loads(first)
     if meta['table']!=table or meta['db']!='primary':raise ValueError('SCOPE_MISMATCH')
     columns=[c['name'] for c in meta['columns']]
     if columns!=report['tables'][table]['columns']:raise ValueError('COLUMN_MISMATCH')
     db.execute(next(s['sql'] for s in meta['schema'] if s['type']=='table' and s['name']==table))
     sql='INSERT INTO "'+table+'"(rowid,'+','.join('"'+c+'"' for c in columns)+') VALUES('+','.join('?' for _ in range(len(columns)+1))+')'
     for line in f:
      stream_hash.update(line);d=json.loads(line)
      if d['kind']=='page':
       if d['after']!=cursor:raise ValueError('CURSOR_MISMATCH')
       batch=[]
       for row in d['rows']:
        if row['__archive_rowid']<=cursor:raise ValueError('ROW_ORDER')
        cursor=row['__archive_rowid'];batch.append([cursor]+[row[c] for c in columns])
       db.executemany(sql,batch);n+=len(batch)
      elif d['kind']=='end':end=d
     if not end or end['rows']!=n or end['upperRowid']!=cursor or n!=receipt['rows']:raise ValueError('INCOMPLETE_EXPORT')
     if stream_hash.hexdigest()!=receipt['streamSha256']:raise ValueError('STREAM_SHA256_MISMATCH')
     for s in meta['schema']:
      if s['type']=='index' and s['sql']:db.execute(s['sql'])
     h=hashlib.sha256()
     for row in db.execute('SELECT '+','.join('"'+c+'"' for c in columns)+' FROM "'+table+'" ORDER BY id'):
      h.update(json.dumps(row,ensure_ascii=False,separators=(',',':')).encode()+b'\n')
     if h.hexdigest()!=report['tables'][table]['fieldsSha256']:raise ValueError('FIELD_PARITY_MISMATCH')
     db.commit()
   if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('INTEGRITY')
   if db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('FOREIGN_KEYS')
   return {'state':'INDEPENDENT_DOWNLOAD_RESTORE_VERIFIED','rows':report['rows'],'tables':list(TABLES),'integrity':'ok','schemaRestored':True,'allFieldsVerified':True,'originalRowidsRestored':True,'archiveSha256':expected_sha}
  finally:db.close()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('archive');p.add_argument('destination');p.add_argument('--sha256',required=True);a=p.parse_args()
 print(json.dumps(restore(a.archive,a.destination,a.sha256)))
