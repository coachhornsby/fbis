"""Offline private FanMatch-to-ESPN reconciliation. No provider requests or predictions."""
import collections,csv,datetime,hashlib,json,pathlib,re,sys,unicodedata

def key(x):return re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(x)).encode('ascii','ignore').decode().lower()).strip()
def lookup(index,name):
 s=index.get(key(name),set());return next(iter(s))if len(s)==1 else None
def add(index,name,tid):
 if name:index[key(name)].add(tid)
def tip_minutes(value):
 m=re.match(r'^(\d{1,2}):(\d{2})\s+(AM|PM)(?:\s|$)',value)
 if not m or not 1<=int(m[1])<=12 or int(m[2])>=60:return None
 return(int(m[1])%12+(12 if m[3]=='PM'else 0))*60+int(m[2])
def match_event(events,first,second,neutral):
 pair={first,second}
 if None in pair or len(pair)!=2:return None
 hits=[e for e in events if {e['awayId'],e['homeId']}==pair and(e['neutralSite']if neutral else e['awayId']==first and e['homeId']==second)]
 if len(hits)>1:raise ValueError('AMBIGUOUS_EVENT_PAIR')
 return hits[0]if hits else None

def run(base):
 base=pathlib.Path(base);p=base/'cbb-fixture-integrity';fm=list(csv.DictReader((p/'fanmatch.csv').open()));packet=json.loads((base/'cbb-projection-phase/private-projections.json').read_text());events=packet['events'];idx=collections.defaultdict(set)
 seen=set()
 for e in events:
  if e['eventId']in seen:raise ValueError('DUPLICATE_ESPN_EVENT')
  seen.add(e['eventId'])
  if e['date']!='2026-11-02':raise ValueError('SLATE_DATE_MISMATCH')
 for f in ['20261102-espn.json','20261103-espn.json']:
  for event in json.loads((base/'cbb-projection-phase'/f).read_text())['events']:
   for c in event['competitions']:
    for x in c['competitors']:
     t=x['team']
     for name in [t.get('location'),t.get('displayName'),t.get('shortDisplayName')]:add(idx,name,'cbb-'+str(t['id']))
 for r in json.loads((base/'cbb-provider-mission/normalized-provider-inputs.json').read_text()):
  if r['provider']=='kenpom':
   t=json.loads(r['payload']);add(idx,t['team'],t['canonicalId'])
 aliases=json.loads((pathlib.Path(__file__).resolve().parents[1]/'data/cbb-fixture-source-aliases.json').read_text())
 known={e[k]for e in events for k in ['homeId','awayId']}
 for name,tid in aliases.items():
  if 'cbb-'+tid not in known:raise ValueError('ALIAS_ID_ABSENT_FROM_CAPTURE')
  add(idx,name,'cbb-'+tid)
 matched={};unmatched=[];rows=[]
 for f in fm:
  n=f['location_word']=='vs.'
  if not n and f['location_word']!='at':raise ValueError('VENUE_SYNTAX_UNSUPPORTED')
  first=lookup(idx,f['first_team']);second=lookup(idx,f['second_team']);e=match_event(events,first,second,n)
  if e:
   if e['eventId']in matched:raise ValueError('DUPLICATE_PROVIDER_EVENT')
   local=datetime.datetime.fromisoformat(e['start'].replace('Z','+00:00')).astimezone(__import__('zoneinfo').ZoneInfo('America/Chicago'))
   mins=tip_minutes(f['tip_time_as_shown']);delta=local.hour*60+local.minute-mins if mins is not None else None
   # Compare two Central dates explicitly: source screenshot is Nov 2, not UTC Nov 2.
   reasons=[]
   if local.date().isoformat()!='2026-11-02':reasons.append('DATE_CONFLICT')
   if n!=e['neutralSite']:reasons.append('VENUE_CONFLICT')
   if delta is None:reasons.append('SOURCE_START_UNPARSEABLE')
   elif delta!=0:reasons.append('SOURCE_START_DISAGREEMENT')
   matched[e['eventId']]={'kenpomRow':int(f['row_order']),'timeDifferenceMinutes':delta,'reasons':reasons}
   rows.append({'kenpomRow':int(f['row_order']),'eventId':e['eventId'],'state':'MATCHED','sourceFirstId':first,'sourceSecondId':second,'sourceNeutral':n,'sourceStartText':f['tip_time_as_shown'],'timeDifferenceMinutes':delta})
  else:
   # Home identity can identify a CONFLICT for review; it can never merge opponents.
   candidates=[e for e in events if not n and second and e['homeId']==second]
   conflict=candidates[0]['eventId']if len(candidates)==1 else None
   unmatched.append({'kenpomRow':int(f['row_order']),'firstTeam':f['first_team'],'secondTeam':f['second_team'],'state':'OPPONENT_OR_IDENTITY_CONFLICT','candidateEventId':conflict})
 evidence={}
 for e in events:
  match=matched.get(e['eventId']);reasons=list(match['reasons'])if match else []
  conflicts=[x for x in unmatched if x['candidateEventId']==e['eventId']]
  if conflicts:reasons.append('OPPONENT_CONFLICT')
  local=datetime.datetime.fromisoformat(e['start'].replace('Z','+00:00')).astimezone(__import__('zoneinfo').ZoneInfo('America/Chicago'))
  if local.hour<9:reasons.append('EARLY_START_REQUIRES_OFFICIAL_CONFIRMATION')
  evidence[e['eventId']]={'eventId':e['eventId'],'fixtureKey':e['fixtureKey'],'date':e['date'],'observedAt':'2026-11-02T06:43:00Z','sourceCaptureTimePrecision':'APPROXIMATE_MINUTE','snapshotOnly':True,'blocked':bool(reasons),'reasons':reasons,'benchmarkPresent':bool(match),'benchmarkAbsenceDoesNotInvalidateFixture':not match and not conflicts,'canAuthorizeWager':False}
 summary={'espnFixtures':len(events),'kenpomRows':len(fm),'matchedKenpomFixtures':len(matched),'unmatchedKenpomRows':unmatched,'espnWithoutMatchedBenchmark':[e['eventId']for e in events if e['eventId']not in matched],
 'holds':[{k:v for k,v in x.items()if k in ['eventId','reasons']}for x in evidence.values()if x['blocked']], 'predictionNumbersPublished':0,'providerRequests':0,'productionChanged':False}
 for name,obj in [('reconciled-rows.json',rows),('fixture-evidence.json',evidence),('receipt.json',summary)]:p.joinpath(name).write_text(json.dumps(obj,indent=2))
 return summary
if __name__=='__main__':print(json.dumps(run(pathlib.Path(sys.argv[1]if len(sys.argv)>1 else 'artifacts')),indent=2))
