import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('stage',pathlib.Path(__file__).resolve().parents[1]/'scripts/cbb-grok-stage.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class StagingTests(unittest.TestCase):
 def test_ambiguous_team_never_resolves(self):
  from collections import defaultdict
  i=defaultdict(set);m.add_name(i,'Miami','cbb-193');m.add_name(i,'Miami','cbb-2390');self.assertIsNone(m.resolve(i,'Miami'));self.assertIsNone(m.resolve(i,'Miam'))
 def test_name_candidates_never_claim_verified_identity(self):
  c=[{'name':'John Doe','espnPlayerId':'1'}];p=[{'name':'John Doe','torvikPlayerId':'99'}];r=m.player_candidates(c,p)[0];self.assertEqual(r['identityState'],'UNIQUE_NAME_CANDIDATE');self.assertFalse(r['verifiedPlayerIdentity']);self.assertIsNone(r['productionAdjustment'])
 def test_duplicate_current_or_prior_names_block_candidate(self):
  c=[{'name':'John Doe'},{'name':'John Doe'}];p=[{'name':'John Doe','torvikPlayerId':'99'}];self.assertTrue(all(x['identityState']=='AMBIGUOUS_NAME'for x in m.player_candidates(c,p)))
  self.assertEqual(m.player_candidates(c[:1],p+[{'name':'John Doe','torvikPlayerId':'98'}])[0]['identityState'],'AMBIGUOUS_NAME')
 def test_suffixes_not_collapsed(self):
  self.assertNotEqual(m.name_key('John Doe Jr.'),m.name_key('John Doe'))
 def game(self):
  x=[0]*53;x[0]='20251104';x[6]='A vs B';x[23]=2;x[25]=1;x[27]=1;x[33]=8;x[51]=99;x[52]=2026;return x
 def test_valid_scoring_and_duplicate_rejection(self):
  x=self.game();self.assertTrue(m.validate_player_games([x]));
  with self.assertRaisesRegex(ValueError,'DUPLICATE'):m.validate_player_games([x,x])
 def test_wrong_scoring_season_width_and_date(self):
  for col,value in [(33,9),(52,2027),(0,'20261104')]:
   x=self.game();x[col]=value
   with self.assertRaises(ValueError):m.validate_player_games([x])
  with self.assertRaises(ValueError):m.validate_player_games([self.game()[:-1]])
if __name__=='__main__':unittest.main()
