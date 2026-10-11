#!/usr/bin/env python3
"""Read-only production evidence and bounded free public source capture. No imports."""
import argparse,csv,datetime,hashlib,json,os,pathlib,subprocess,urllib.request
ACCOUNT='2fdc80b8d99070adcef12f7a785c3fc1'
DB='b50c724c-903b-4241-8ce1-48d931e7a44c'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
def write(path,value):path.write_text(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n')
def query(sql):
 if not sql.startswith('SELECT ') or ';' in sql:raise ValueError('Only one SELECT allowed')
 req=urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query',data=json.dumps({'sql':sql}).encode(),headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],'Content-Type':'application/json'},method='POST')
 with urllib.request.urlopen(req,timeout=90) as response:body=json.load(response)
 if not body.get('success') or not body['result'][0].get('success'):raise RuntimeError('Read-only D1 query failed')
 result=body['result'][0]
 if result.get('meta',{}).get('changed_db'):raise RuntimeError('Unexpected database mutation')
 return result.get('results',[])
def paged(sql,max_pages=100):
 rows=[]
 for page in range(max_pages):
  batch=query(sql+' LIMIT 500 OFFSET '+str(page*500));rows.extend(batch)
  if len(batch)<500:return rows
 raise RuntimeError('Bounded query truncated; refusing partial evidence')
def capture(root,code_sha):
 root.mkdir(parents=True,exist_ok=True);receipts=[]
 def receipt(path,source):receipts.append({'file':path.name,'source':source,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'observed_at':now(),'source_publication_at':None})
 for tag,name in [('espn_cfb_schedules','cfb_schedule_2026.csv'),('espn_cfb_team_box','team_box_2026.csv'),('espn_cfb_player_box','player_box_2026.csv')]:
  url=f'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/{tag}/{name}'
  path=root/name
  with urllib.request.urlopen(url,timeout=150) as response,path.open('wb') as target:
   size=0
   while chunk:=response.read(1024*1024):
    size+=len(chunk)
    if size>64*1024*1024:raise RuntimeError('Source exceeds bounded acquisition limit')
    target.write(chunk)
  receipt(path,url)
 queries={
  'canonical-teams.json':"SELECT * FROM cfb_canonical_teams ORDER BY team_id",
  'memberships.json':"SELECT team_id,player_id,season FROM cfb_roster_membership WHERE season=2026 AND team_id IN (SELECT team_id FROM cfb_canonical_teams WHERE active=1 AND upper(trim(subdivision))='FBS') ORDER BY team_id,player_id",
  'legacy-captures.json':"SELECT id,game_id,model_version,frozen_at,deployment_commit,layers_json,proj_home,proj_away,proj_margin,proj_total FROM prediction_snapshots WHERE sport='cfb' ORDER BY id",
  'production-upcoming.json':"SELECT id,start,home_name,away_name FROM games WHERE sport='cfb' AND start>strftime('%Y-%m-%dT%H:%M:%SZ','now') ORDER BY start,id",
 }
 for filename,sql in queries.items():
  path=root/filename;write(path,paged(sql));receipt(path,'D1_READ_ONLY:'+DB)
 # SDV's completed-game release is not an upcoming-event discovery contract.
 # Query exact public ESPN calendar days; keep canonical numeric provider IDs.
 fixtures={};discovery=[]
 today=datetime.datetime.now(datetime.timezone.utc).date()
 for offset in range(-7,15):
  day=today+datetime.timedelta(days=offset)
  url='https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=1000&dates='+day.strftime('%Y%m%d')
  path=root/('espn-schedule-'+day.isoformat()+'.json')
  with urllib.request.urlopen(url,timeout=60) as response:
   data=response.read(8*1024*1024+1)
  if len(data)>8*1024*1024:raise RuntimeError('ESPN discovery response exceeds limit')
  path.write_bytes(data);receipt(path,url);body=json.loads(data)
  events=body.get('events')
  if not isinstance(events,list) or len(events)>=1000:raise RuntimeError('Invalid or truncated ESPN calendar response')
  discovery.append({'day':day.isoformat(),'events':len(events)})
  for event in events:
   competitions=event.get('competitions') or []
   if len(competitions)!=1:raise RuntimeError('Ambiguous event competition')
   c=competitions[0];competitors=c.get('competitors') or []
   sides={r.get('homeAway'):r for r in competitors}
   if len(competitors)!=2 or set(sides)!={'home','away'}:raise RuntimeError('Ambiguous scheduled participants')
   f={'game_id':str(event['id']),'season':event.get('season',{}).get('year'),
      'game_date':event.get('date'),'status':event.get('status',{}).get('type',{}).get('name'),
      'home_id':str(sides['home']['team']['id']),'away_id':str(sides['away']['team']['id']),
      'home_team':sides['home']['team'].get('displayName'),'away_team':sides['away']['team'].get('displayName'),
      'neutral_site':c.get('neutralSite'),'venue_id':c.get('venue',{}).get('id'),
      'source_file':path.name,'provider_start_time_tbd':c.get('timeValid') is False}
   old=fixtures.get(f['game_id'])
   if old and (old['home_id'],old['away_id'],old['game_date'])!=(f['home_id'],f['away_id'],f['game_date']):raise RuntimeError('Conflicting schedule versions within capture')
   fixtures[f['game_id']]=f
 write(root/'schedule.json',list(fixtures.values()));receipt(root/'schedule.json','FBIS_EXACT_ID_ESPN_SCHEDULE_NORMALIZATION')
 write(root/'schedule-discovery.json',discovery)
 write(root/'capture-receipts.json',{'code_sha':code_sha,'receipts':receipts,'production_mutation':False,'paid_provider_usage':False,'capture_finished_at':now(),'upstream_license_qualification':'Research only; public SDV availability does not establish upstream redistribution rights'})
 # All normalized evidence is labelled with the actual completed acquisition clock.
 ts=now()
 common=['--schedule',str(root/'cfb_schedule_2026.csv'),'--fbs-teams','data/cfb/fbs-2026-active-team-ids.csv','--season','2026','--source-observed-at',ts]
 subprocess.run(['python3','scripts/cfb-sdv-player-box-normalize.py','--player-box',str(root/'player_box_2026.csv'),*common,'--output-prefix',str(root/'fbs-2026')],check=True)
 subprocess.run(['python3','scripts/cfb-sdv-team-box-normalize.py','--team-box',str(root/'team_box_2026.csv'),*common,'--output-prefix',str(root/'fbs-2026-team')],check=True)
 subprocess.run(['python3','scripts/cfb-team-player-stat-staging.py','--archive',str(root/'fbs-2026-team.team-game.csv'),'--team-manifest',str(root/'fbs-2026-team.manifest.json'),'--archive-observed-at',ts,'--player-csv',str(root/'fbs-2026.player-game.csv'),'--player-manifest',str(root/'fbs-2026.manifest.json'),'--season','2026','--output-prefix',str(root/'fbs-2026-ledger')],check=True)
 for name in ['fbs-2026-ledger.team-game.jsonl','fbs-2026-ledger.player-game.jsonl','fbs-2026-ledger.manifest.json']:receipt(root/name,'FBIS_NORMALIZATION_FROM_CAPTURED_SDV')
 write(root/'capture-receipts.json',{'code_sha':code_sha,'receipts':receipts,'production_mutation':False,'paid_provider_usage':False,'capture_finished_at':now(),'upstream_license_qualification':'Research only; upstream redistribution rights pending qualification'})
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output-dir',required=True);p.add_argument('--code-sha',required=True);a=p.parse_args();capture(pathlib.Path(a.output_dir),a.code_sha)
