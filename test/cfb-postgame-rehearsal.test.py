import copy
import pathlib
import sys
import tempfile
import unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from cfb_postgame_rehearsal import Ledger, aggregate

AT='2026-10-11T00:20:00Z'
DIRECTORY={('home',2026):{'provider_id':'1','classification':'FBS'},('away',2026):{'provider_id':'2','classification':'FCS'}}
MEMBERS={('qb','home',2026):[{'provider_id':'10','from':'2026-01-01T00:00:00Z','to':'2027-01-01T00:00:00Z'}]}
def game():
 return {'game_id':'g1','provider_game_id':'100','season':2026,'game_at':'2026-10-10T20:00:00Z',
  'observed_at':'2026-10-11T00:10:00Z','source':'qualified-fixture','status':'FINAL','scores':{'home':28,'away':14},
  'temporal_class':'POSTGAME_OBSERVED','teams':[
   {'team_id':'home','provider_team_id':'1','side':'home','team_complete':True,'player_complete':True,
    'metrics':{'points':28,'yards':400,'plays':80,'sacks':None},'players':[{'player_id':'qb','provider_player_id':'10','participated':True,'metrics':{'pass_yards':200,'completions':20,'pass_attempts':30}}]},
   {'team_id':'away','provider_team_id':'2','side':'away','team_complete':True,'player_complete':True,
    'metrics':{'points':14,'yards':250,'plays':50},'players':[]}]}
class Pipeline(unittest.TestCase):
 def setUp(self):self.l=Ledger()
 def process(self,p=None,**kw):return self.l.process(p or game(),DIRECTORY,MEMBERS,kw.pop('at',AT),**kw)
 def card(self,team='home'):
  import json
  r=self.l.db.execute('SELECT body FROM card_versions c JOIN current_cards p ON c.id=p.version_id WHERE p.team_id=?',(team,)).fetchone();return json.loads(r[0])
 def test_both_cards_players_fbs_fcs(self):
  v=self.process();self.assertEqual(self.card()['game_versions'],[v]);self.assertEqual(self.card('away')['record']['losses'],1)
  self.assertEqual(self.card()['players']['qb']['pass_yards']['total'],200);self.assertEqual(self.card()['offense']['sacks']['games'],0)
 def test_duplicate_and_new_retrieval_no_count(self):
  v=self.process();p=game();p['observed_at']='2026-10-11T00:11:00Z';self.assertEqual(v,self.process(p));self.assertEqual(self.card()['games'],1)
 def test_atomic_failure_restart(self):
  with self.assertRaises(OSError):self.process(fail_at=0)
  self.assertEqual(self.l.db.execute('SELECT COUNT(*) FROM current_cards').fetchone()[0],0)
  self.assertEqual(self.l.health()['states']['RETRY_PENDING'],1);self.process();self.assertEqual(self.card()['games'],1)
 def test_correction_preserves_snapshot(self):
  v=self.process();s,b=self.l.snapshot('next',['home','away'],2026,'2026-10-11T00:25:00Z','2026-10-17T20:00:00Z')
  p=game();p['observed_at']='2026-10-11T00:30:00Z';p['teams'][0]['metrics']['yards']=420
  self.process(p,at='2026-10-11T00:31:00Z');self.assertEqual(self.card()['offense']['yards']['total'],420)
  self.assertEqual(b['game_versions'],[v]);self.assertEqual(self.l.snapshot('next',['home','away'],2026,'2026-10-11T00:25:00Z','2026-10-17T20:00:00Z')[0],s)
  self.assertEqual(self.l.db.execute('SELECT COUNT(*) FROM card_versions').fetchone()[0],4)
 def test_old_replay_quarantined(self):
  self.process();p=game();p['observed_at']='2026-10-11T00:30:00Z';p['teams'][0]['metrics']['yards']=420;self.process(p,at='2026-10-11T00:31:00Z')
  with self.assertRaises(ValueError):self.process(game(),at='2026-10-11T00:32:00Z')
 def test_partial_blocks_both(self):
  p=game();p['teams'][1]['player_complete']=False
  with self.assertRaises(LookupError):self.process(p)
  self.assertEqual(self.l.health()['states']['PARTIAL_SOURCE'],1);self.assertEqual(self.l.db.execute('SELECT COUNT(*) FROM current_cards').fetchone()[0],0)
 def test_invalid_cases(self):
  for mutation in ['status','identity','participation','membership','score','metric','future','duplicates']:
   p=game();members=copy.deepcopy(MEMBERS)
   if mutation=='status':p['status']='IN_PROGRESS'
   if mutation=='identity':p['teams'][0]['provider_team_id']='bad'
   if mutation=='participation':p['teams'][0]['players'][0]['participated']=False
   if mutation=='membership':members[('qb','home',2026)][0]['from']='2026-10-12T00:00:00Z'
   if mutation=='score':p['scores']['home']=29
   if mutation=='metric':p['teams'][0]['metrics']['yards']=float('nan')
   if mutation=='future':p['observed_at']='2026-10-12T00:00:00Z'
   if mutation=='duplicates':p['teams'][0]['players']*=2
   with self.subTest(mutation=mutation),self.assertRaises(ValueError):self.l.process(p,DIRECTORY,members,AT)
 def test_overtime_valid_final(self):
  p=game();p['overtime']=3;p['scores']['home']=49;p['teams'][0]['metrics']['points']=49;self.process(p);self.assertEqual(self.card()['offense']['points']['total'],49)
 def test_classification_by_season(self):
  d=copy.deepcopy(DIRECTORY);d[('home',2026)]['classification']='FCS'
  with self.assertRaises(ValueError):self.l.process(game(),d,MEMBERS,AT)
 def test_restart_durable(self):
  with tempfile.TemporaryDirectory() as t:
   p=str(pathlib.Path(t)/'db.sqlite');a=Ledger(p);v=a.process(game(),DIRECTORY,MEMBERS,AT);a.db.close();b=Ledger(p)
   self.assertEqual(b.process(game(),DIRECTORY,MEMBERS,AT),v);self.assertEqual(b.health()['missing_card_pairs'],0)
 def test_discovery_and_duplicate_final(self):
  for state in ['SCHEDULED','IN_PROGRESS','POSTPONED','CANCELLED','SUSPENDED','FINAL']:
   self.l.discover({'game_id':'g1','status':state},AT)
  self.process();self.l.discover({'game_id':'g1','status':'FINAL'},AT);self.assertEqual(self.l.health()['states']['VERIFIED'],1)
 def test_pit_rejects_late_and_retrospective(self):
  p=game();p['temporal_class']='RETROSPECTIVE';self.process(p)
  _,b=self.l.snapshot('next',['home','away'],2026,'2026-10-11T00:25:00Z','2026-10-17T20:00:00Z');self.assertEqual(b['game_versions'],[])
  with self.assertRaises(ValueError):self.l.snapshot('next',['home'],2026,AT,AT)
 def test_late_normalization_excluded_from_pit(self):
  self.process()
  _,b=self.l.snapshot('next',['home','away'],2026,'2026-10-11T00:15:00Z','2026-10-17T20:00:00Z')
  self.assertEqual(b['game_versions'],[])
 def test_chronological_replay_features_and_correction(self):
  first=self.process()
  _,a=self.l.snapshot('next',['home','away'],2026,'2026-10-11T00:25:00Z','2026-10-17T20:00:00Z')
  self.assertEqual(a['team_state']['home']['games'],1)
  second=game();second['game_id']='g2';second['provider_game_id']='101';second['game_at']='2026-10-17T20:00:00Z';second['observed_at']='2026-10-18T00:10:00Z'
  second['scores']['home']=42;second['teams'][0]['metrics']['points']=42
  self.process(second,at='2026-10-18T00:20:00Z')
  _,b=self.l.snapshot('third',['home','away'],2026,'2026-10-18T00:25:00Z','2026-10-24T20:00:00Z')
  self.assertEqual(b['team_state']['home']['offense']['points']['mean'],35)
  self.assertEqual(a['team_state']['home']['offense']['points']['mean'],28)
  self.assertEqual(self.card()['games'],2)
 def test_paired_ratios_missing_not_zero(self):
  a=aggregate([{'yards':100,'plays':20},{'yards':None,'plays':80}]);self.assertEqual(a['yards_per_play']['value'],5);self.assertEqual(a['yards_per_play']['games'],1)
if __name__=='__main__':unittest.main()
