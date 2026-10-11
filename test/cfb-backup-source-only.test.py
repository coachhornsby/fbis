import gzip,hashlib,importlib.util,json,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('backup',pathlib.Path(__file__).parents[1]/'scripts/cfb-existing-backup-verify.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class SourceOnlyRecovery(unittest.TestCase):
 def test_full_fixture_without_unlanded_migrations(self):
  sql=b'CREATE TABLE source(id INTEGER PRIMARY KEY);\nINSERT INTO source VALUES(1);\nCREATE TABLE schema_migrations(id TEXT);\nCREATE TABLE d1_migrations(id INTEGER);\n'
  with tempfile.TemporaryDirectory() as d:
   archive=gzip.compress(sql);root=pathlib.Path(d);(root/'backup.part.0000').write_bytes(archive)
   manifest={'database_id':'b50c724c-903b-4241-8ce1-48d931e7a44c','bookmark':'synthetic-test-only','parts':[{'name':'backup.part.0000','bytes':len(archive),'sha256':hashlib.sha256(archive).hexdigest()}],'archive_bytes':len(archive),'archive_sha256':hashlib.sha256(archive).hexdigest(),'source_sql_bytes':len(sql),'sql_sha256':hashlib.sha256(sql).hexdigest()}
   r=module.verify(manifest,root);self.assertEqual(r['status'],'VERIFIED_LOCAL_FULL_RESTORE');self.assertEqual(r['restored_table_counts']['source'],1);self.assertEqual(r['rehearsed_migrations'],[]);self.assertIsNone(r['migration_preservation']);self.assertIsNone(r['postmigration_integrity']);self.assertFalse(r['remote_d1_full_restore_verified']);self.assertEqual(r['production_mutations'],0)
if __name__=='__main__':unittest.main()
