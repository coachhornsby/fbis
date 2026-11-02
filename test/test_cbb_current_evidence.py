import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('current',pathlib.Path(__file__).resolve().parents[1]/'scripts/cbb-grok-current-evidence.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class CurrentEvidenceTests(unittest.TestCase):
 def team(self):return {'espn_event_id':'1','side':'home','espn_team_id':'2','team':'Home','status':'UNKNOWN','espn_player_id':''}
 def board(self):return {'events':[{'id':'1','competitions':[{'competitors':[{'homeAway':'home','team':{'id':'2','displayName':'Home'}},{'homeAway':'away','team':{'id':'3','displayName':'Away'}}]}]}]}
 def test_unknown_team_pairs_bind_without_health_claim(self):
  r=self.team();a,b=m.bind_team_rows([r,{**r,'side':'away','espn_team_id':'3','team':'Away'}],self.board(),{'1'});self.assertEqual(len(a),2);self.assertEqual(b,[]);self.assertTrue(all(x['availability']=='UNKNOWN' and not x['canAdjustModel'] for x in a))
 def test_wrong_teams_and_claimed_healthy_states_are_quarantined(self):
  for patch in [{'espn_team_id':'9'},{'status':'ACTIVE'},{'espn_player_id':'99'}]:
   a,b=m.bind_team_rows([{**self.team(),**patch}],self.board(),{'1'});self.assertEqual(a,[]);self.assertEqual(len(b),1)
 def test_official_bio_claim_is_not_cross_provider_identity_verification(self):
  lead={'espnPlayerId':'1','name':'Player','researchState':'ONE_SAME_TEAM_LEAD','canonicalTeamId':'cbb-2','sameTeamTorvikIdLead':'3'}
  bio={'espnPlayerId':'1','name':'Player','espn_team_id':'2','torvik_same_team_candidate':'3','classification':'VERIFIED_SAME_TEAM'}
  o=m.bind_bio_rows([bio],[lead])[0];self.assertFalse(o['verifiedPlayerIdentity']);self.assertFalse(o['canAdjustModel']);self.assertEqual(o['availability'],'UNKNOWN')
  with self.assertRaises(ValueError):m.bind_bio_rows([{**bio,'espn_team_id':'9'}],[lead])
  with self.assertRaises(ValueError):m.bind_bio_rows([],[lead])
if __name__=='__main__':unittest.main()
