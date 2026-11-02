import copy,hashlib,importlib.util,io,pathlib,tarfile,tempfile,unittest
spec=importlib.util.spec_from_file_location('intake',pathlib.Path(__file__).resolve().parents[1]/'scripts/cbb-research-intake.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ResearchIntakeTests(unittest.TestCase):
 def archive(self,files):
  b=io.BytesIO()
  with tarfile.open(fileobj=b,mode='w:gz') as t:
   for name,data in files.items():
    i=tarfile.TarInfo(name);i.size=len(data);t.addfile(i,io.BytesIO(data))
  return b.getvalue()
 def verify(self,b):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'a.tar.gz';p.write_bytes(b)
   return m.verified_members(p,m.sha(b))
 def test_manifest_tamper_and_missing_coverage_rejected(self):
  h=m.sha(b'good')
  for files in [{'r/a':b'bad','r/MANIFEST.sha256':f'{h}  ./a\n'.encode()},
                {'r/a':b'good','r/b':b'extra','r/MANIFEST.sha256':f'{h}  ./a\n'.encode()}]:
   with self.assertRaises(ValueError):self.verify(self.archive(files))
 def test_traversal_and_duplicate_members_rejected(self):
  with self.assertRaisesRegex(ValueError,'ARCHIVE_PATH'):self.verify(self.archive({'../escape':b'x'}))
 def test_external_hash_required(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'a';p.write_bytes(self.archive({'a':b'ok'}))
   with self.assertRaisesRegex(ValueError,'ARCHIVE_HASH'):m.verified_members(p,'0'*64)
 def test_preserve_quote_times_and_do_not_inherit_sizes(self):
  raw={'ticker':'KXNCAAMBGAME-26NOV02NIUGRAM-NIU','yes_bid_dollars':'.5','yes_ask_dollars':'.6','yes_bid_size_fp':'10','yes_ask_size_fp':'20'}
  early={'ticker':raw['ticker'],'yes_bid':'.51','yes_ask':'.61','yes_ask_size_fp':'999'}
  a=m.normalize_kalshi(raw,'raw','2026-11-02T07:08:00Z',False,True)
  b=m.normalize_kalshi(early,'csv',m.ct_time('2026-11-02 01:14:10 CST'),None)
  self.assertEqual(a['yesAskSize'],20);self.assertIsNone(b['yesAskSize'])
  self.assertNotEqual(a['capturedAt'],b['capturedAt']);self.assertFalse(b['freshForExecution']);self.assertIsNone(b['sportsbookLine'])
 def test_invalid_quotes_rejected_and_crossed_preserved(self):
  for v in ['NaN','inf','-1','1.1']:
   with self.assertRaises(ValueError):m.numeric(v,True)
  q=m.normalize_kalshi({'ticker':'KXNCAAMBGAME-X-Y','yes_bid':'.8','yes_ask':'.2'},'f','t',False)
  self.assertEqual(q['quoteState'],'CROSSED');self.assertFalse(q['canAuthorizeWager'])
 def test_identity_lead_cannot_promote_and_wrong_candidate_rejected(self):
  current=[{'espnPlayerId':'1','name':'Chris Jones','canonicalTeamId':'cbb-1','identityState':'AMBIGUOUS_NAME'}]
  history=[{'torvikPlayerId':'2','season':2026,'sourceTeam':'Example','canonicalTeamId':'cbb-1','games':3,'name':'Chris Jones'}]
  r={'espnPlayerId':'1','name':'Chris Jones','currentCanonicalTeamId':'cbb-1','n_candidates':'1',
    'candidates(torvikId|season|team|canonical|games)':'2|2026|Example|cbb-1|3','same_team_candidates':'2','triage':'ONE_SAME_TEAM_CANDIDATE'}
  o=m.triage_identities([r],current,history)[0]
  self.assertFalse(o['verifiedPlayerIdentity']);self.assertEqual(o['availability'],'UNKNOWN');self.assertFalse(o['canAdjustModel'])
  r['same_team_candidates']='999'
  with self.assertRaises(ValueError):m.triage_identities([r],current,history)
  with self.assertRaises(ValueError):m.triage_identities([],current,history)
 def test_fixture_binding_rejects_date_or_home_away_drift(self):
  events=[{'eventId':eid,'awayName':a,'homeName':h,'date':'2026-11-02','neutralSite':True,'start':'2026-11-02T08:00Z'} for eid,a,h in m.EARLY_FIXTURES.values()]
  q=m.normalize_kalshi({'ticker':'KXNCAAMBGAME-26NOV02NIUGRAM-NIU'},'f','t',False)
  self.assertEqual(m.bind_early_fixtures([q],events)[0]['canonicalEventId'],'401920912')
  events[0]['date']='2026-11-03'
  with self.assertRaises(ValueError):m.bind_early_fixtures([q],events)

if __name__=='__main__':unittest.main()
