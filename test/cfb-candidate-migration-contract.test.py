import pathlib,sqlite3,unittest
ROOT=pathlib.Path(__file__).parents[1]/'docs/sql/cfb-review-20261011'
A=(ROOT/'0098-college-persistence.sql').read_text();B=(ROOT/'0099-cfb-statistical-ledgers.sql').read_text();ORIGINAL=(ROOT/'0099-original.sql').read_text()
def fresh():
 c=sqlite3.connect(':memory:');c.execute('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT)');c.execute("INSERT INTO schema_migrations VALUES('0097','original-clock')");c.commit();return c
class MigrationContracts(unittest.TestCase):
 def test_0098_matches_original_required_columns_indexes_and_keys(self):
  import json
  contracts=json.loads((ROOT/'0098-original-contract.json').read_text());c=fresh();c.executescript(A)
  for table,expected in contracts.items():
   cols=[dict(zip(['name','type','notnull','dflt_value','pk'],r[1:])) for r in c.execute('PRAGMA table_info('+table+')')]
   self.assertEqual(cols,expected['columns'])
   indexes=[dict(zip(['name','sql'],r)) for r in c.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name",(table,))]
   self.assertEqual(indexes,expected['indexes']);self.assertEqual(list(c.execute('PRAGMA foreign_key_list('+table+')')),expected['foreignKeys'])
 def test_order_idempotency_and_history(self):
  c=fresh()
  with self.assertRaises(sqlite3.DatabaseError):c.executescript(B)
  c.executescript(A);c.executescript(B);before=list(c.execute('SELECT * FROM schema_migrations ORDER BY id'));c.executescript(A);c.executescript(B);self.assertEqual(before,list(c.execute('SELECT * FROM schema_migrations ORDER BY id')));self.assertEqual(c.execute("SELECT applied_at FROM schema_migrations WHERE id='0097'").fetchone()[0],'original-clock')
 def test_original_guard_missing_uniqueness_regression(self):
  import re
  bad=re.sub(r',\n UNIQUE\([^\n]*\)','',ORIGINAL);c=fresh();c.executescript(A);c.executescript(bad);c.executescript(ORIGINAL)
  with self.assertRaisesRegex(sqlite3.DatabaseError,'malformed JSON'):c.executescript(B)
 def test_wrong_required_index_blocks_before_ddl(self):
  c=fresh();c.executescript(A);c.executescript(B);c.execute('DROP INDEX idx_cfb_team_game_stats_team');c.execute('CREATE INDEX idx_cfb_team_game_stats_team ON cfb_team_game_stat_observations(source)')
  before=list(c.execute('SELECT type,name,sql FROM sqlite_master ORDER BY type,name'))
  with self.assertRaises(sqlite3.DatabaseError):c.executescript(B)
  self.assertEqual(before,list(c.execute('SELECT type,name,sql FROM sqlite_master ORDER BY type,name')))
 def test_missing_index_repairs_and_existing_rows_preserved(self):
  c=fresh();c.executescript(A);c.executescript(B);c.execute("INSERT INTO cfb_team_season_stat_snapshots(id,team_id,season,source,observed_at,content_hash,metrics_json) VALUES('kept','cfb:espn:1',2026,'fixture','2026-10-11T00:00:00Z','hash','{}')");before=list(c.execute('SELECT * FROM cfb_team_season_stat_snapshots'));c.execute('DROP INDEX idx_cfb_team_season_stats');c.executescript(B);self.assertEqual(before,list(c.execute('SELECT * FROM cfb_team_season_stat_snapshots')))
 def test_research_cannot_gain_model_authority(self):
  c=fresh();c.executescript(A);c.executescript(B)
  with self.assertRaises(sqlite3.IntegrityError):c.execute("INSERT INTO cfb_team_season_stat_snapshots(id,team_id,season,source,observed_at,content_hash,metrics_json,can_influence_projection) VALUES('bad','t',2026,'s','at','h','{}',1)")
 def test_extra_trigger_or_changed_default_rejected(self):
  c=fresh();c.executescript(A);c.executescript(B);c.execute('CREATE TRIGGER surprise AFTER INSERT ON cfb_team_season_stat_snapshots BEGIN SELECT 1; END')
  with self.assertRaises(sqlite3.DatabaseError):c.executescript(B)
if __name__=='__main__':unittest.main()
