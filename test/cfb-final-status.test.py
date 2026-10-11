import pathlib,sys,unittest
import pandas as pd
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from cfb_final_status import final_mask
class Status(unittest.TestCase):
 def test_numeric_scores_never_substitute_for_final(self):
  f=pd.DataFrame({'status':['STATUS_FINAL','STATUS_CANCELED','STATUS_POSTPONED','STATUS_IN_PROGRESS','STATUS_FINAL'],
   'home_score':[0,0,0,28,None],'away_score':[0,0,0,21,7]})
  self.assertEqual(final_mask(f).tolist(),[True,False,False,False,False])
 def test_missing_status_fail_closed(self):
  with self.assertRaises(ValueError):final_mask(pd.DataFrame({'home_score':[28],'away_score':[14]}))
if __name__=='__main__':unittest.main()
