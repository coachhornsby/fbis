#!/usr/bin/env python3
"""Partition an already verified export at complete SQL statements, offline only.

No remote API or database writes. Never concatenate different bookmarks. D1
execution is a separate nonproduction drill; this manifest does not qualify it.
"""
import argparse,gzip,hashlib,json,pathlib,re,sqlite3

def partition(source,report,destination,max_bytes=64*1024*1024):
 if report.get('status')!='VERIFIED_LOCAL_FULL_RESTORE' or report.get('integrity')!=['ok'] or report.get('foreign_key_violation_count')!=0:
  raise ValueError('Accepted full local reconciliation required')
 if not 1024<=max_bytes<=100*1024*1024:raise ValueError('Unqualified partition bound')
 root=pathlib.Path(destination)
 if root.exists():raise ValueError('Fresh destination required')
 root.mkdir(parents=True);parts=[];buffer=b'';current=bytearray();source_hash=hashlib.sha256();total=0;statements=0
 def flush():
  if not current:return
  data=bytes(current);name=f'import-{len(parts):04d}.sql';(root/name).write_bytes(data)
  parts.append({'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()});current.clear()
 opener=gzip.open if str(source).endswith('.gz') else open
 with opener(source,'rb') as stream:
  for line in stream:
   source_hash.update(line);total+=len(line);buffer+=line
   if len(buffer)>max_bytes:raise ValueError('SQL statement exceeds partition bound')
   if not sqlite3.complete_statement(buffer.decode('utf-8')):continue
   statement=buffer.decode('utf-8').lstrip()
   while statement.startswith('--'):
    _,_,statement=statement.partition('\n');statement=statement.lstrip()
   if re.match(r'BEGIN\b|COMMIT\b|END\b|ROLLBACK\b|SAVEPOINT\b|RELEASE\b',statement,re.I):
    raise ValueError('Explicit transaction requires a separately reviewed D1 transformation')
   if len(current)+len(buffer)>max_bytes:flush()
   current.extend(buffer);buffer=b'';statements+=1
 if buffer.strip():raise ValueError('Truncated SQL')
 if buffer:current.extend(buffer)
 flush()
 if total!=report['sql_bytes'] or source_hash.hexdigest()!=report['sql_sha256']:raise ValueError('Source checksum mismatch')
 result={'status':'VERIFIED_OFFLINE_STATEMENT_PARTITIONS','bookmark':report['bookmark'],'source_database':report['source_database'],
  'source_sql_sha256':source_hash.hexdigest(),'source_sql_bytes':total,'statements':statements,'parts':parts,
  'max_part_bytes':max_bytes,'remote_d1_restore_verified':False,'production_mutations':0,
  'execution_order':[p['name'] for p in parts],
  'acceptance':['fresh isolated database UUID','ordered supported D1 file imports','every source table count matches the accepted reconciliation report','schema, keys, indexes, ledgers and integrity agree','no skipped statements'],
  'rollback':'Stop imports. Retain the partial isolated target and logs for diagnosis; never point this procedure at production.'}
 (root/'partition-manifest.json').write_text(json.dumps(result,indent=2)+'\n');return result

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--reconciliation',required=True);p.add_argument('--destination',required=True)
 a=p.parse_args();partition(a.source,json.loads(pathlib.Path(a.reconciliation).read_text()),a.destination)
