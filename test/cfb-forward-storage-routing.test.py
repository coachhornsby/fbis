import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('capture',pathlib.Path(__file__).parents[1]/'scripts/cfb-forward-capture.py');capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)
class Routing(unittest.TestCase):
 def test_sport_owned_roster_and_directory(self):
  for table in ['cfb_roster_membership','cfb_canonical_players','cfb_canonical_teams']:
   self.assertEqual(capture.database_for_query('SELECT * FROM '+table),capture.CFB_DB)
 def test_shared_features_remain_primary(self):
  self.assertEqual(capture.database_for_query("SELECT * FROM team_feature_snapshots WHERE sport='cfb'"),capture.DB)
 def test_joined_roster_uses_cfb(self):
  self.assertEqual(capture.database_for_query('SELECT m.player_id FROM cfb_roster_membership m JOIN cfb_canonical_teams t ON t.team_id=m.team_id'),capture.CFB_DB)
if __name__=='__main__':unittest.main()
