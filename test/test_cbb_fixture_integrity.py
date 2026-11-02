import importlib.util,pathlib,unittest
s=importlib.util.spec_from_file_location('f',pathlib.Path(__file__).resolve().parents[1]/'scripts/cbb-fixture-integrity.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class FixtureIntegrityTests(unittest.TestCase):
 def event(self):return {'eventId':'1','homeId':'H','awayId':'A','neutralSite':False}
 def test_home_away_reversal_is_not_a_match(self):
  self.assertIsNone(m.match_event([self.event()],'H','A',False));self.assertEqual(m.match_event([self.event()],'A','H',False)['eventId'],'1')
 def test_neutral_order_can_reverse_but_neutral_flag_must_agree(self):
  e={**self.event(),'neutralSite':True};self.assertIsNotNone(m.match_event([e],'H','A',True));self.assertIsNone(m.match_event([self.event()],'H','A',True))
 def test_missing_opponent_and_duplicate_pair_rejected(self):
  self.assertIsNone(m.match_event([self.event()],None,'H',False))
  with self.assertRaises(ValueError):m.match_event([self.event(),self.event()],'A','H',False)
 def test_clock_parsing_rejects_invalid_and_keeps_minutes(self):
  self.assertEqual(m.tip_minutes('12:01 AM'),1);self.assertEqual(m.tip_minutes('12:00 PM (TV)'),720);self.assertEqual(m.tip_minutes('5:31 PM'),1051)
  for v in ['TBD','13:00 PM','5:60 PM']:self.assertIsNone(m.tip_minutes(v))
if __name__=='__main__':unittest.main()
