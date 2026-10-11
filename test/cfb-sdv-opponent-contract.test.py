import csv,importlib.util,pathlib,tempfile,types,unittest
ROOT=pathlib.Path(__file__).parents[1]
def module(file):
 spec=importlib.util.spec_from_file_location(file,ROOT/'scripts'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
p=module('cfb-sdv-player-box-normalize.py');t=module('cfb-sdv-team-box-normalize.py')
def write(path,rows):
 with path.open('w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=sorted(set().union(*(r.keys() for r in rows))));w.writeheader();w.writerows(rows)
def scheduled(gid='100',home='1',away='2',status='STATUS_FINAL'):
 return {'game_id':gid,'season':'2026','home_id':home,'away_id':away,'home_team':'H','away_team':'A','start_date':'2026-10-10T20:00:00Z','home_score':'28','away_score':'14','status':status,'completed':'true'}
class OpponentContracts(unittest.TestCase):
 def test_both_sides_retained_only_for_fbs_involving_game(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);write(root/'fbs.csv',[{'team_id':'1','subdivision':'FBS'}]);write(root/'schedule.csv',[scheduled(),scheduled('200','3','4')])
   write(root/'team.csv',[{'season':'2026','game_id':g,'team_id':team,'home_away':side,'totalYards':'400'} for g,team,side in [('100','1','home'),('100','2','away'),('200','3','home'),('200','4','away')]])
   write(root/'player.csv',[{'season':'2026','game_id':g,'team_id':team,'athlete_id':ath,'category':'rushing','rushingYards':'10'} for g,team,ath in [('100','1','11'),('100','2','22'),('200','3','33')]])
   args=types.SimpleNamespace(season=2026,fbs_teams=str(root/'fbs.csv'),schedule=str(root/'schedule.csv'),source_observed_at='2026-10-11T01:00:00Z',team_box=str(root/'team.csv'),player_box=str(root/'player.csv'),player_box_member=None,include_non_fbs_opponents=True)
   self.assertEqual({r['team_id'] for r in t.normalize(args)[0]},{'1','2'});self.assertEqual({r['team_id'] for r in p.build(args)[0]},{'1','2'})
   args.include_non_fbs_opponents=False;self.assertEqual({r['team_id'] for r in t.normalize(args)[0]},{'1'});self.assertEqual({r['team_id'] for r in p.build(args)[0]},{'1'})
 def test_overtime_final_and_duplicate_notifications(self):
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d)/'schedule.csv';row=scheduled(status='STATUS_FINAL_OVERTIME');write(path,[row,row]);games,qa=p.from_completed_schedule(path,2026);self.assertEqual(len(games),2);self.assertEqual(qa['accepted'],1)
 def test_conflicting_participants_or_result_quarantined(self):
  for field,value in [('home_id','9'),('home_score','29'),('start_date','2026-10-11T20:00:00Z')]:
   with tempfile.TemporaryDirectory() as d:
    path=pathlib.Path(d)/'schedule.csv';other=scheduled();other[field]=value;write(path,[scheduled(),other])
    with self.assertRaisesRegex(ValueError,'Conflicting'):p.from_completed_schedule(path,2026)
 def test_nonfinal_invalid_scores_or_same_team_rejected(self):
  for field,value in [('status','STATUS_CANCELED'),('home_score','NaN'),('home_score','-1'),('home_id','2')]:
   with tempfile.TemporaryDirectory() as d:
    path=pathlib.Path(d)/'schedule.csv';row=scheduled();row[field]=value;write(path,[row]);self.assertEqual(p.from_completed_schedule(path,2026)[0],{})
if __name__=='__main__':unittest.main()
