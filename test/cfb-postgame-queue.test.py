import copy,pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from cfb_postgame_queue import Queue
D={('h',2026):{'provider_id':'1','classification':'FBS'},('a',2026):{'provider_id':'2','classification':'FCS'}}
def game(status='FINAL'):
 return {'game_id':'g','season':2026,'source':'fixture','status':status,'observed_at':'2026-10-11T00:00:00Z','teams':[{'team_id':'h','provider_team_id':'1'},{'team_id':'a','provider_team_id':'2'}]}
class DurableQueue(unittest.TestCase):
 def test_missed_scheduler_and_restart(self):
  with tempfile.TemporaryDirectory() as d:
   path=str(pathlib.Path(d)/'queue.db');a=Queue(path);a.reconcile([game()],D,'2026-10-11T01:00:00Z');a.db.close();b=Queue(path)
   self.assertEqual(b.claim('2026-10-12T01:00:00Z')['game_id'],'g')
 def test_only_final_and_retains_fbs_fcs(self):
  for status in ['SCHEDULED','IN_PROGRESS','POSTPONED','CANCELLED','SUSPENDED']:
   q=Queue();q.reconcile([game(status)],D,'2026-10-11T01:00:00Z');self.assertIsNone(q.claim('2026-10-11T01:00:00Z'))
  q=Queue();q.reconcile([game()],D,'2026-10-11T01:00:00Z');self.assertEqual(q.health('2026-10-11T01:00:00Z')['final_games'],1)
 def test_duplicate_final_does_not_regress_lease(self):
  q=Queue();q.reconcile([game()],D,'2026-10-11T01:00:00Z');c=q.claim('2026-10-11T01:00:00Z');q.reconcile([game()],D,'2026-10-11T01:01:00Z')
  self.assertIsNone(q.claim('2026-10-11T01:01:00Z'));q.finish(c,'2026-10-11T01:01:00Z',version='v1');self.assertEqual(q.health('2026-10-11T01:01:00Z')['unverified_final_games'],[])
 def test_expired_worker_cannot_publish(self):
  q=Queue();q.reconcile([game()],D,'2026-10-11T01:00:00Z');a=q.claim('2026-10-11T01:00:00Z');b=q.claim('2026-10-11T01:06:00Z')
  with self.assertRaisesRegex(ValueError,'lease'):q.finish(a,'2026-10-11T01:06:01Z',version='old')
  q.finish(b,'2026-10-11T01:06:01Z',state='PARTIAL_SOURCE',error='players missing');self.assertEqual(q.health('2026-10-11T01:07:00Z')['states']['PARTIAL_SOURCE'],1)
 def test_correction_and_noop_version(self):
  q=Queue();q.reconcile([game()],D,'2026-10-11T01:00:00Z')
  for at,version in [('2026-10-11T01:00:01Z','v1'),('2026-10-11T01:16:01Z','v1'),('2026-10-11T01:32:01Z','v2')]:
   c=q.claim(at);self.assertIsNotNone(c);q.finish(c,at,version=version)
  self.assertEqual(q.health('2026-10-11T01:33:00Z')['states']['CORRECTED'],1)
 def test_invalid_batch_is_atomic_and_identity_is_exact(self):
  q=Queue();bad=game();bad['game_id']='bad';bad['teams'][0]['provider_team_id']='other'
  with self.assertRaises(ValueError):q.reconcile([game(),bad],D,'2026-10-11T01:00:00Z')
  self.assertEqual(q.health('2026-10-11T01:00:00Z')['final_games'],0)
 def test_official_result_reversal_quarantined(self):
  q=Queue();q.reconcile([game()],D,'2026-10-11T01:00:00Z');c=q.claim('2026-10-11T01:00:00Z');q.finish(c,'2026-10-11T01:01:00Z',version='v1')
  g=game('CANCELLED');g['observed_at']='2026-10-11T01:02:00Z';q.reconcile([g],D,'2026-10-11T01:02:00Z');self.assertEqual(q.health('2026-10-11T01:02:00Z')['quarantined_games'],['g'])
 def test_official_status_change_revokes_worker_publication(self):
  q=Queue();q.reconcile([game()],D,'2026-10-11T01:00:00Z');c=q.claim('2026-10-11T01:00:00Z')
  g=game('SUSPENDED');g['observed_at']='2026-10-11T01:01:00Z';q.reconcile([g],D,'2026-10-11T01:01:00Z')
  with self.assertRaisesRegex(ValueError,'lease'):q.finish(c,'2026-10-11T01:02:00Z',version='invalid')
 def test_restart_then_atomic_cards_and_correction_sequence(self):
  import importlib.util
  spec=importlib.util.spec_from_file_location('fixtures',pathlib.Path(__file__).with_name('cfb-postgame-rehearsal.test.py'));f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
  with tempfile.TemporaryDirectory() as d:
   q=Queue(str(pathlib.Path(d)/'queue.db'));l=f.Ledger(str(pathlib.Path(d)/'ledger.db'));p=f.game()
   g={'game_id':p['game_id'],'season':p['season'],'source':p['source'],'status':'FINAL','observed_at':p['observed_at'],'teams':p['teams']}
   q.reconcile([g],f.DIRECTORY,f.AT);c=q.claim(f.AT)
   with self.assertRaises(OSError):l.process(p,f.DIRECTORY,f.MEMBERS,f.AT,fail_at=0)
   q.finish(c,f.AT,state='RETRY_PENDING',error='atomic rollback')
   self.assertEqual(l.db.execute('SELECT COUNT(*) FROM current_cards').fetchone()[0],0)
   q.db.close();q=Queue(str(pathlib.Path(d)/'queue.db'));c=q.claim('2026-10-11T00:36:00Z');v=l.process(p,f.DIRECTORY,f.MEMBERS,'2026-10-11T00:36:00Z');q.finish(c,'2026-10-11T00:36:00Z',version=v)
   _,snapshot=l.snapshot('next',['home','away'],2026,'2026-10-11T00:37:00Z','2026-10-17T20:00:00Z')
   p['observed_at']='2026-10-11T00:52:00Z';p['teams'][0]['metrics']['yards']=420;c=q.claim('2026-10-11T00:53:00Z');v2=l.process(p,f.DIRECTORY,f.MEMBERS,'2026-10-11T00:53:00Z');q.finish(c,'2026-10-11T00:53:00Z',version=v2)
   self.assertEqual(snapshot['game_versions'],[v]);self.assertNotEqual(v,v2);self.assertEqual(l.health()['missing_card_pairs'],0);self.assertEqual(q.health('2026-10-11T00:54:00Z')['states']['CORRECTED'],1)
if __name__=='__main__':unittest.main()
