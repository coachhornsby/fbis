import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('evidence',pathlib.Path(__file__).resolve().parents[1]/'scripts/cbb-roster-evidence.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RosterEvidenceTests(unittest.TestCase):
 def prior(self):return {'torvikPlayerId':'1','name':'John Doe','sourceTeam':'A','games':1,'heightInches':78,'hometown':'Houston, TX','pointsFromSeasonShooting':8,'shootingTotals':{'ftm':1,'fta':2,'twoMade':2,'twoAttempts':3,'threeMade':1,'threeAttempts':2}}
 def current(self):return {'name':'John Doe','height':78,'birthPlace':{'city':'Houston','state':'TX'}}
 def game(self):
  x=[0]*53;x[51]=2;x[48]='John Doe';x[47]='A';x[33]=8
  for c,v in [(27,1),(28,2),(23,2),(24,3),(25,1),(26,2)]:x[c]=v
  return x
 def test_corroboration_requires_all_attributes(self):
  self.assertTrue(m.corroborate(self.current(),self.prior(),True))
  self.assertFalse(m.corroborate(self.current(),self.prior(),False))
  for c in [{'name':'John Doe','height':79,'birthPlace':{'city':'Houston','state':'TX'}},{'name':'John Doe','height':78},{'name':'John Doe Jr','height':78,'birthPlace':{'city':'Houston','state':'TX'}}]:self.assertFalse(m.corroborate(c,self.prior(),True))
 def test_no_city_only_match(self):
  c=self.current();c['birthPlace']['state']='CA';self.assertFalse(m.corroborate(c,self.prior(),True))
 def test_exact_stats_bridge_preserves_both_source_ids(self):
  r,_=m.audit_history([self.prior()],[self.game()]);self.assertEqual(r[0]['torvikPlayerId'],'1');self.assertEqual(r[0]['gameFilePlayerId'],'2');self.assertEqual(r[0]['historyState'],'CONSISTENT_CAPTURE')
 def test_shooting_attempt_mismatch_blocks_bridge(self):
  x=self.game();x[24]=4;r,_=m.audit_history([self.prior()],[x]);self.assertEqual(r[0]['historyState'],'QUARANTINED')
 def test_ambiguous_game_identity_blocks_bridge(self):
  a=self.game();b=self.game();b[51]=3;r,_=m.audit_history([self.prior()],[a,b]);self.assertEqual(r[0]['historyState'],'QUARANTINED')
 def test_two_profiles_cannot_reuse_one_game_id(self):
  with self.assertRaisesRegex(ValueError,'NON_INJECTIVE'):m.audit_history([self.prior(),self.prior()],[self.game()])
 def row(self):
  r=['0']*67;r[0]='John Doe';r[1]='A';r[3]='1';r[4]='50';r[5]='100';r[6]='20';r[26]='6-6';r[31]='2026';r[32]='1';r[33]='Houston, TX';return r
 def test_documented_percent_fields_keep_percent_units(self):
  p=m.parse_season(self.row());self.assertEqual(p['minutesSharePct'],50);self.assertEqual(p['usagePct'],20);self.assertNotIn('expectedMinutes',p)
 def test_reject_wrong_season_schema_scale_and_id(self):
  for col,value in [(31,'2027'),(4,'101'),(6,'-1'),(32,'x')]:
   r=self.row();r[col]=value
   with self.assertRaises(ValueError):m.parse_season(r)
  with self.assertRaises(ValueError):m.parse_season(self.row()[:-1])
 def test_invalid_height_not_guessed(self):
  self.assertIsNone(m.height_inches('6-15'));self.assertIsNone(m.height_inches('unknown'));self.assertEqual(m.height_inches('6-6'),78)
if __name__=='__main__':unittest.main()
