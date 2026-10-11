#!/usr/bin/env python3
"""Bounded free SDV acquisition and every-column coverage audit; no CFBD/prod writes."""
import argparse,csv,datetime,hashlib,json,pathlib,urllib.request,urllib.error,concurrent.futures
DATASETS={
 'schedules':('espn_cfb_schedules','cfb_schedule'), 'team_box':('espn_cfb_team_box','team_box'),
 'player_box':('espn_cfb_player_box','player_box'), 'drives':('espn_cfb_drives','drives'),
 'game_rosters':('espn_cfb_game_rosters','game_rosters'), 'play_participants':('espn_cfb_play_participants','play_participants'),
 'linescores':('espn_cfb_linescores','linescores'), 'power_index':('espn_cfb_power_index','power_index'),
 'adv_team':('espn_cfb_adv_team','adv_team'), 'adv_passing':('espn_cfb_adv_passing','adv_passing'),
 'adv_rushing':('espn_cfb_adv_rushing','adv_rushing'), 'adv_receiving':('espn_cfb_adv_receiving','adv_receiving'),
 'adv_defensive':('espn_cfb_adv_defensive','adv_defensive'), 'adv_defensive_players':('espn_cfb_adv_defensive_players','adv_defensive_players'),
 'adv_drives':('espn_cfb_adv_drives','adv_drives'), 'adv_situational':('espn_cfb_adv_situational','adv_situational'),
 'adv_specialists':('espn_cfb_adv_specialists','adv_specialists'), 'adv_turnover':('espn_cfb_adv_turnover','adv_turnover'),
 'passing':('espn_cfb_passing','cfb_passing'), 'rushing':('espn_cfb_rushing','cfb_rushing'),
 'receiving':('espn_cfb_receiving','cfb_receiving'), 'percentiles':('espn_cfb_percentiles','cfb_percentiles'),
 'team_summaries':('espn_cfb_team_summaries','cfb_team_summaries'), 'adv_team_gamelog':('espn_cfb_adv_team_gamelog','adv_team_gamelog'),
 'ratings_weekly':('cfb_ratings_weekly','cfb_ratings_weekly'), 'team_summaries_weekly':('cfb_team_summaries_weekly','cfb_team_summaries_weekly'),
 'usage_players':('espn_cfb_usage_players','usage_players'), 'usage_position_groups':('espn_cfb_usage_position_groups','usage_position_groups'),
 'usage_tackles':('espn_cfb_usage_tackles','usage_tackles'), 'usage_position_group_tackles':('espn_cfb_usage_position_group_tackles','usage_position_group_tackles'),
 'usage_teams':('espn_cfb_usage_teams','usage_teams'), 'usage_drive_scripting':('espn_cfb_usage_drive_scripting','usage_drive_scripting'),
 'usage_st_kickers':('espn_cfb_usage_st_kickers','usage_st_kickers'), 'usage_st_punters':('espn_cfb_usage_st_punters','usage_st_punters'),
 'usage_st_returners':('espn_cfb_usage_st_returners','usage_st_returners'), 'usage_st_blocks':('espn_cfb_usage_st_blocks','usage_st_blocks'),
 'usage_st_team':('espn_cfb_usage_st_team','usage_st_team'), 'team_tendencies':('espn_cfb_team_tendencies','team_tendencies'),
 'coach_tendencies':('espn_cfb_coach_tendencies','coach_tendencies'),
}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
def capture(family,season,root,limit):
 tag,prefix=DATASETS[family];filename=f'{prefix}_{season}.csv';url=f'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/{tag}/{filename}'
 entry={'family':family,'url':url,'observed_at':now(),'status':'UNAVAILABLE','historical_pit_qualified':False,'production_consumed':False}
 path=root/filename
 try:
  with urllib.request.urlopen(url,timeout=90) as response,path.open('wb') as f:
   entry['source_last_modified']=response.headers.get('Last-Modified');size=0
   while chunk:=response.read(1024*1024):
    size+=len(chunk)
    if size>limit:raise ValueError('TOO_LARGE_FOR_BOUNDED_CSV_CAPTURE; use column-selective offline parquet')
    f.write(chunk)
  with path.open(newline='') as f:
   reader=csv.DictReader(f);columns=reader.fieldnames or [];missing={c:0 for c in columns};n=0;season_values=set()
   for row in reader:
    if None in row or any(row.get(c) is None for c in columns):raise ValueError('Malformed CSV width')
    n+=1
    if 'season' in row:season_values.add(row['season'])
    for c in columns:
     if str(row[c]).strip().upper() in ('','NA','NAN','NULL','NONE'):missing[c]+=1
   if season_values and season_values!={str(season)}:raise ValueError('Season scope mismatch')
  entry.update(status='AVAILABLE' if n else 'AVAILABLE_EMPTY',file=filename,rows=n,bytes=size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),columns=columns,missing_by_column=missing,acquired_at=now(),source_publication_at=None)
 except Exception as error:
  path.unlink(missing_ok=True);entry['error']=str(error)
 return entry
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--season',type=int,default=2026);p.add_argument('--datasets',default=','.join(DATASETS));p.add_argument('--max-bytes',type=int,default=64*1024*1024);a=p.parse_args()
 root=pathlib.Path(a.output);root.mkdir(parents=True,exist_ok=True);families=a.datasets.split(',')
 if any(x not in DATASETS for x in families):raise SystemExit('Unknown source contract')
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(lambda f:capture(f,a.season,root,a.max_bytes),families))
 report={'version':'cfb-sdv-coverage-v1','season':a.season,'generated_at':now(),'paid_provider_usage':False,'production_mutation':False,'datasets':results,'available':sum(r['status']=='AVAILABLE' for r in results),'registered':len(DATASETS),'pit_policy':'Acquisition timestamps are current observations, not reconstructed historical evidence. Whole-season tables must not enter prior-week backtests.','license_policy':'Public SDV assets retain upstream provenance; this capture grants no additional redistribution rights.','large_source_policy':'PBP/model-PBP remain column-selective offline Parquet jobs; do not place full play tables inside a Worker response.'}
 (root/'coverage-manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'registered':len(DATASETS),'attempted':len(results),'available':report['available'],'unavailable':[(r['family'],r.get('error')) for r in results if r['status']=='UNAVAILABLE']}))
