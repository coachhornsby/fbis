"""Bounded operator capture of current public CBB team/roster inputs, with checkpoints."""
import json,pathlib,urllib.request,concurrent.futures,hashlib,gzip
OUT=pathlib.Path(__file__).resolve().parents[1]/'artifacts/cbb-current-2027'
OUT.mkdir(parents=True,exist_ok=True)
BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball'
def fetch(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'FBIS-CBB/1.0'}),timeout=20)as r:
  b=r.read(2097153)
  if len(b)>2097152:raise ValueError('byte limit')
  return json.loads(b),r.headers.get('Date')
p=OUT/'teams.json'
if p.exists():teams=json.loads(p.read_text())
else:
 j,_=fetch(BASE+'/teams?limit=500&season=2027');teams=[t['team']for t in j['sports'][0]['leagues'][0]['teams']]
 for tid in ['2511','88','2815']:
  if tid not in {str(t['id'])for t in teams}:j,_=fetch(BASE+'/teams/'+tid);teams.append(j['team'])
 p.write_text(json.dumps(teams))
assert len(teams)==365 and len({t['id']for t in teams})==365
(OUT/'raw').mkdir(exist_ok=True)
def capture(t):
 p=OUT/'raw'/(str(t['id'])+'.json')
 if p.exists():return json.loads(p.read_text())
 try:
  j,at=fetch(BASE+'/teams/'+str(t['id'])+'/roster?season=2027')
  assert j['season']['year']==2027 and str(j['team']['id'])==str(t['id'])
  a=j['athletes'];assert 0<len(a)<=60 and all(x.get('id')and x.get('displayName')for x in a)
  result={'ok':True,'teamId':'cbb-'+str(t['id']),'season':2027,'observedAt':at,'source':'ESPN','payload':j}
  p.write_text(json.dumps(result));return result
 except Exception as e:return {'ok':False,'teamId':'cbb-'+str(t['id']),'error':type(e).__name__}
rows=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:
 for row in pool.map(capture,teams):
  rows.append(row)
  if len(rows)%50==0:print('captured',len(rows),flush=True)
report={'season':2027,'teamsExpected':365,'teamsWithRoster':sum(r['ok']for r in rows),'players':sum(len(r['payload']['athletes'])for r in rows if r['ok']),'failed':[r for r in rows if not r['ok']],'injuryStatus':'UNKNOWN unless independently verified','automaticSchedule':False}
(OUT/'manifest.json').write_text(json.dumps(report,indent=2))
with gzip.open(OUT/'rosters.ndjson.gz','wt')as f:
 for r in rows:f.write(json.dumps(r)+'\n')
print(json.dumps(report),flush=True)
