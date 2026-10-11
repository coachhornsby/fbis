import hashlib,importlib.util,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('partition',pathlib.Path(__file__).parents[1]/'scripts/cfb-d1-import-partition.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class PartitionContracts(unittest.TestCase):
 def run_source(self,sql,wrong=False):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);source=root/'source.sql';source.write_bytes(sql)
   report={'status':'VERIFIED_LOCAL_FULL_RESTORE','integrity':['ok'],'foreign_key_violation_count':0,'bookmark':'single-bookmark','source_database':'isolated-fixture','sql_bytes':len(sql),'sql_sha256':'wrong' if wrong else hashlib.sha256(sql).hexdigest()}
   result=module.partition(source,report,root/'parts',1024)
   rebuilt=b''.join((root/'parts'/p['name']).read_bytes() for p in result['parts']);self.assertEqual(rebuilt,sql)
   return result
 def test_complete_quoted_and_multiline_statements(self):
  sql=b"CREATE TABLE t(x TEXT);\n"+b"INSERT INTO t VALUES('semicolon;\n-- literal content "+b'x'*600+b"');\n"+b"INSERT INTO t VALUES('"+b'y'*600+b"');\n"
  result=self.run_source(sql);self.assertEqual(len(result['parts']),2);self.assertFalse(result['remote_d1_restore_verified'])
 def test_checksum_mismatch_stops_acceptance(self):
  with self.assertRaisesRegex(ValueError,'checksum'):self.run_source(b'CREATE TABLE t(x);\n',True)
 def test_explicit_cross_file_transaction_rejected(self):
  with self.assertRaisesRegex(ValueError,'transaction'):self.run_source(b'BEGIN;\nCREATE TABLE t(x);\nCOMMIT;\n')
if __name__=='__main__':unittest.main()
