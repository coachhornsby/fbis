import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('dependency',pathlib.Path(__file__).parents[1]/'scripts/cfb-d1-dependency-plan.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class DependencyContracts(unittest.TestCase):
 def report(self,sql):
  return {'status':'VERIFIED_LOCAL_FULL_RESTORE','integrity':['ok'],'foreign_key_violation_count':0,'bookmark':'fixture-bookmark','source_database':'fixture-only','sql_sha256':'fixture-hash','schema':[{'type':'table','name':n,'sql':s} for n,s in sql.items()],'restored_table_counts':{n:1 for n in sql}}
 def test_child_exported_first_is_ordered_after_parent(self):
  r=self.report({'child':'CREATE TABLE child(id PRIMARY KEY,parent_id REFERENCES parent(id))','parent':'CREATE TABLE parent(id PRIMARY KEY)'})
  p=module.plan(r);self.assertLess(p['table_import_order'].index('parent'),p['table_import_order'].index('child'));self.assertFalse(p['execution_authorized']);self.assertEqual(p['production_mutations'],0)
 def test_self_reference_requires_indivisible_review(self):
  with self.assertRaisesRegex(ValueError,'cycle'):module.plan(self.report({'tree':'CREATE TABLE tree(id PRIMARY KEY,parent REFERENCES tree(id))'}))
 def test_mutual_cycle_rejected(self):
  with self.assertRaisesRegex(ValueError,'cycle'):module.plan(self.report({'a':'CREATE TABLE a(id PRIMARY KEY,b REFERENCES b(id))','b':'CREATE TABLE b(id PRIMARY KEY,a REFERENCES a(id))'}))
 def test_missing_parent_rejected(self):
  with self.assertRaisesRegex(ValueError,'Unknown'):module.plan(self.report({'a':'CREATE TABLE a(id PRIMARY KEY,b REFERENCES missing(id))'}))
 def test_sequence_restored_last(self):
  r=self.report({'a':'CREATE TABLE a(id INTEGER PRIMARY KEY AUTOINCREMENT)'});r['restored_table_counts']['sqlite_sequence']=1
  self.assertEqual(module.plan(r)['table_import_order'],['a','sqlite_sequence'])
 def test_scope_and_failed_integrity_rejected(self):
  r=self.report({'a':'CREATE TABLE a(id)'});r['restored_table_counts']['extra']=0
  with self.assertRaisesRegex(ValueError,'scope'):module.plan(r)
  r=self.report({'a':'CREATE TABLE a(id)'});r['foreign_key_violation_count']=1
  with self.assertRaisesRegex(ValueError,'restoration'):module.plan(r)
if __name__=='__main__':unittest.main()
