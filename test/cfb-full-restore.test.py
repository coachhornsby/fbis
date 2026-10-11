import hashlib,importlib.util,pathlib,sqlite3,tempfile,unittest
spec=importlib.util.spec_from_file_location('drill',pathlib.Path(__file__).parents[1]/'scripts/cfb-d1-full-restore.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class FullRecovery(unittest.TestCase):
 def fixture(self,root):
  sql='CREATE TABLE parent(id INTEGER PRIMARY KEY AUTOINCREMENT);\nCREATE TABLE child(id INTEGER PRIMARY KEY,parent REFERENCES parent(id),v TEXT);\nCREATE TABLE schema_migrations(id TEXT);\nCREATE TABLE d1_migrations(id INTEGER);\nINSERT INTO schema_migrations VALUES(\'0097\');\nINSERT INTO d1_migrations VALUES(97);\nINSERT INTO child VALUES(1,1,\'quoted;\\nvalue\');\nINSERT INTO parent VALUES(1);\nDELETE FROM sqlite_sequence;\nINSERT INTO sqlite_sequence VALUES(\'parent\',3);\n'
  source=root/'source.sql';source.write_text(sql);db=sqlite3.connect(':memory:');db.executescript(sql)
  report={'status':'VERIFIED_LOCAL_FULL_RESTORE','integrity':['ok'],'foreign_key_violation_count':0,'source_database':'fixture','bookmark':'fixture','sql_sha256':hashlib.sha256(sql.encode()).hexdigest(),'sql_bytes':len(sql.encode()),'source_statement_count':10,'restored_table_counts':m.counts(db),'schema':m.schemas(db),'migration_ledgers_before':{t:list(db.execute('SELECT * FROM '+m.quote(t))) for t in ['schema_migrations','d1_migrations']}}
  report['table_content_digests']={t:m.content_digest(db,t) for t in report['restored_table_counts']}
  return source,report
 def test_complete_fk_enforced_restore_and_sequence(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);source,r=self.fixture(root);p=m.stage(source,r,root/'parts',1024);m.rehearse(root/'parts',p,r)
   self.assertEqual(p['status'],'VERIFIED_LOCAL_FK_ENFORCED_PARTS');self.assertFalse(p['remote_d1_restore_verified']);self.assertLess(next(i for i,x in enumerate(p['parts']) if x['group']=='parent'),next(i for i,x in enumerate(p['parts']) if x['group']=='child'))
 def test_tampered_part_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);source,r=self.fixture(root);p=m.stage(source,r,root/'parts',1024);(root/'parts'/p['parts'][0]['name']).write_text('SELECT 1;')
   with self.assertRaisesRegex(ValueError,'checksum'):m.rehearse(root/'parts',p,r)
 def test_source_hash_and_statement_count_rejected(self):
  for field in ['sql_sha256','source_statement_count']:
   with tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d);source,r=self.fixture(root);r[field]='bad' if field=='sql_sha256' else 1
    with self.assertRaises(ValueError):m.stage(source,r,root/'parts',1024)
 def test_production_and_existing_rehearsal_forbidden(self):
  for target in m.FORBIDDEN:
   with self.assertRaisesRegex(ValueError,'Nonproduction'):m.target_guard(target,'fbis-cfb-full-recovery-20261011-1')
  with self.assertRaises(ValueError):m.target_guard('00000000-0000-0000-0000-000000000000','fbis')
 def test_content_fingerprint_detects_same_count_correction(self):
  db=sqlite3.connect(':memory:');db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY,v TEXT)');db.execute("INSERT INTO t VALUES(1,'old')");a=m.content_digest(db,'t');db.execute("UPDATE t SET v='new'");b=m.content_digest(db,'t');self.assertEqual(a['rows'],b['rows']);self.assertNotEqual(a['sha256'],b['sha256'])
 def test_lossless_text_blob_real_and_minimum_rowid(self):
  db=sqlite3.connect(':memory:');db.execute('CREATE TABLE t(id INTEGER PRIMARY KEY,v)')
  for i,v in enumerate(['a\x00b',b'a\x00b',1.0000000000000002,None]):db.execute('INSERT INTO t VALUES(?,?)',(-9223372036854775808+i,v))
  a=m.content_digest(db,'t');self.assertEqual(a['rows'],4)
  db.execute("UPDATE t SET v='a' WHERE id=-9223372036854775808");self.assertNotEqual(a['sha256'],m.content_digest(db,'t')['sha256'])
 def test_unsupported_mutation_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);source,r=self.fixture(root);source.write_text(source.read_text()+'UPDATE parent SET id=2;\n')
   with self.assertRaisesRegex(ValueError,'Unsupported'):m.stage(source,r,root/'parts',1024)
 def test_full_remote_reconciliation_contract_without_network(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);source,r=self.fixture(root);parts=m.stage(source,r,root/'parts',1024);m.rehearse(root/'parts',parts,r)
   class Fake(m.Remote):
    def __init__(self):
     self.path=root/'remote.json';self.journal={'status':'NOT_STARTED','production_mutations':0,'imports':[]};self.target=None;self.name=None;self.db=sqlite3.connect(':memory:');self.db.execute('PRAGMA foreign_keys=ON');self.index=0;self.calls=[]
    def api(self,method,path,body=None):
     self.calls.append(path)
     if path=='/d1/database':return {'uuid':'00000000-0000-0000-0000-000000000001'}
     m.target_guard(self.target,self.name)
     if path.endswith('/query'):
      cur=self.db.execute(body['sql']);return [{'success':True,'results':[dict(zip([x[0] for x in cur.description],row)) for row in cur]}]
     if body['action']=='init':return {'filename':'fixture'}
     if body['action']=='ingest':
      self.db.executescript((root/'parts'/parts['parts'][self.index]['name']).read_text());self.index+=1;return {'status':'complete'}
     raise AssertionError('Unexpected operation')
   fake=Fake();result=fake.execute(root/'parts',parts,r,123)
   self.assertTrue(result['complete_content_reconciliation']);self.assertEqual(fake.index,len(parts['parts']));self.assertEqual(result['production_mutations'],0)
   self.assertFalse(any(t in path for t in m.FORBIDDEN for path in fake.calls))
if __name__=='__main__':unittest.main()
