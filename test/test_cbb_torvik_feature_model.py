import importlib.util,pathlib,unittest,collections,copy,tempfile,csv,json
import numpy as np
spec=importlib.util.spec_from_file_location('m',pathlib.Path(__file__).resolve().parents[1]/'scripts/cbb-torvik-feature-model.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class FeaturesTests(unittest.TestCase):
 def game(self,date,id):
  b=[0]*38;b[0]='11/1/25';b[1]=200;b[2]='A';b[3]='B';b[34]=70
  for o in [4,19]:b[o:o+15]=[20,50,5,20,10,15,5,20,25,10,4,3,10,15,55]
  return {'id':id,'date':date,'box':b,'home':'B','neutral':False}
 def history(self):return [self.game('2025-11-0'+str(i),str(i)) for i in range(1,7)]
 def test_same_day_games_cannot_use_each_others_results(self):
  g=self.history()+[self.game('2025-11-07','7'),self.game('2025-11-07','8')];g[-2]['box'][18]=150
  rows,_=m.chronological_rows(g);same=[r for r in rows if r['date']=='2025-11-07'];np.testing.assert_equal(same[0]['x'],same[1]['x'])
 def test_future_results_do_not_change_prior_features(self):
  g=self.history();a,_=m.chronological_rows(g);g[-1]['box'][18]=200;b,_=m.chronological_rows(g)
  for x,y in zip(a,b):np.testing.assert_equal(x['x'],y['x'])
 def test_four_factors_respond_to_shooting_and_turnovers(self):
  own=np.array([20,50,5,20,10,15,5,20,25,10,4,3,10,15,55]);opp=own.copy();r=m.rates(own,opp,70)
  self.assertAlmostEqual(r[0],.45);self.assertAlmostEqual(r[1],10/70);self.assertAlmostEqual(r[2],.2)
  own[12]=20;self.assertGreater(m.rates(own,opp,70)[1],r[1])
 def test_constant_features_fit_without_nan_and_labels_do_not_enter_feature_vector(self):
  rows=[{'x':np.ones(32),'y':np.array([2.,140.])} for _ in range(8)];model=m.fit(rows,32,10);np.testing.assert_allclose(m.predict(model,np.ones(32)),[2,140]);self.assertEqual(len(m.FEATURES_CORE+m.FEATURES_EXTRA),32)
 def test_duplicate_source_rows_are_deduplicated_and_bad_scoring_quarantined(self):
  good=self.game('2025-11-01','g');b=good['box'];row=['']*31;row[0]=b[0];row[2]='A';row[4]='B';row[5]='A';row[22]='2026';row[24]='g';row[29]=json.dumps(b)
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'x.csv'
   with p.open('w') as f:csv.writer(f).writerows([row,row])
   self.assertEqual(len(m.load_boxes(p)),1)
   b[18]=99;row[29]=json.dumps(b)
   with p.open('w') as f:csv.writer(f).writerow(row)
   games,excluded=m.load_boxes(p,True);self.assertEqual(games,[]);self.assertEqual(excluded,['g'])
if __name__=='__main__':unittest.main()
