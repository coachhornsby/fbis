import importlib.util,json,pathlib,tempfile,unittest,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('importer',ROOT/'scripts/cfb-fbs-2026-research-import.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Import(unittest.TestCase):
 def test_conflict_statement_is_id_only_and_exact_content_checked(self):
  r={'id':'one','team_id':'team','season':2026,'can_influence_projection':0}
  sql=m.statement('team-game',[r]);self.assertIn('ON CONFLICT(id) DO NOTHING',sql);self.assertNotIn('OR IGNORE',sql)
  old=m.rows
  try:
   m.rows=lambda sql:[{'id':'one','team_id':'wrong'}]
   with self.assertRaises(RuntimeError):m.verify_batch('team-game',[r])
  finally:m.rows=old
 def test_partial_recovery_report_never_accepted(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'report.json';p.write_text(json.dumps({'status':'LOCAL_RESTORE_AND_R2_UPLOAD_COMPLETE','database_id':m.DB}))
   with self.assertRaises(RuntimeError):m.backed_up(p)
 def test_quote_null_is_null_and_literal_is_escaped(self):
  self.assertEqual(m.quote(None),'NULL');self.assertEqual(m.quote("a'b"),"'a''b'")
if __name__=='__main__':unittest.main()
