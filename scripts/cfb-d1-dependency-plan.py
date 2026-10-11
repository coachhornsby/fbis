#!/usr/bin/env python3
"""Qualify cross-file foreign-key ordering before an isolated D1 import.

D1 enforces foreign keys at each import transaction boundary. An exact byte
partition alone cannot establish resumable import safety. This offline check
reconstructs the accepted schema and refuses cycles or unknown dependencies.
It never imports, creates a remote database or changes migration history.
"""
import argparse,hashlib,json,pathlib,sqlite3

def plan(report,report_sha256=None):
 if report.get('status')!='VERIFIED_LOCAL_FULL_RESTORE' or report.get('integrity')!=['ok'] or report.get('foreign_key_violation_count')!=0:
  raise ValueError('Accepted local full restoration required')
 if not report.get('bookmark') or not report.get('source_database') or not report.get('sql_sha256'):
  raise ValueError('Source identity and single export bookmark required')
 schema=report.get('schema',[]);counts=report.get('restored_table_counts',{})
 if not isinstance(counts,dict) or not counts:raise ValueError('Complete table counts required')
 tables=[o for o in schema if o['type']=='table' and o.get('sql') and o['name']!='sqlite_sequence']
 connection=sqlite3.connect(':memory:')
 try:
  for obj in tables:connection.execute(obj['sql'])
  actual={r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  if actual!=set(counts):raise ValueError('Schema/count table scope mismatch')
  edges={name:set() for name in actual};foreign_keys=[]
  for name in sorted(actual):
   for row in connection.execute('PRAGMA foreign_key_list("'+name.replace('"','""')+'")'):
    parent=row[2]
    if parent not in actual:raise ValueError('Unknown foreign-key parent '+parent)
    edges[name].add(parent)
    foreign_keys.append({'child':name,'parent':parent,'id':row[0],'sequence':row[1],'from':row[3],'to':row[4],'onUpdate':row[5],'onDelete':row[6]})
  # sqlite_sequence is an engine-owned table. Restore exported sequence values
  # only after all autoincrement inserts; no CREATE TABLE statement is invented.
  remaining=set(actual)-{'sqlite_sequence'};ordered=[]
  while remaining:
   ready=sorted(n for n in remaining if not (edges[n]&remaining))
   if not ready:raise ValueError('Foreign-key cycle requires separately reviewed indivisible import: '+','.join(sorted(remaining)))
   ordered.extend(ready);remaining.difference_update(ready)
  if 'sqlite_sequence' in actual:ordered.append('sqlite_sequence')
  return {'status':'VERIFIED_OFFLINE_DEPENDENCY_GRAPH','bookmark':report['bookmark'],
   'source_database':report['source_database'],'source_sql_sha256':report['sql_sha256'],
   'accepted_reconciliation_sha256':report_sha256,'table_count':len(actual),
   'table_import_order':ordered,'foreign_keys':foreign_keys,'table_counts':counts,
   'source_statement_count':report.get('source_statement_count'),
   'requirements':['create all exported user tables before data','import parent table rows before child table rows','preserve original row order within each table','restore sqlite_sequence after all autoincrement rows','install exported indexes/views/triggers after data','verify full source byte/hash and account for every statement','rehearse each file as a separate foreign-key-enforced transaction','reconcile every table, schema object and ledger against this bookmark'],
   'remote_d1_restore_verified':False,'production_mutations':0,
   'execution_authorized':False,
   'limitations':['This dependency graph does not reorder or validate the full SQL export.','The source export creation timestamp remains whatever the accepted evidence can establish.','No production migration gate is satisfied by this report.']}
 finally:connection.close()

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--reconciliation',required=True);parser.add_argument('--output',required=True)
 args=parser.parse_args();data=pathlib.Path(args.reconciliation).read_bytes()
 result=plan(json.loads(data),hashlib.sha256(data).hexdigest())
 path=pathlib.Path(args.output)
 if path.exists():raise ValueError('Fresh evidence output required')
 path.write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'status':result['status'],'table_count':result['table_count'],'foreign_key_count':len(result['foreign_keys']),'remote_d1_restore_verified':False}))
