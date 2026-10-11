#!/usr/bin/env python3
"""Convert the SDV espn_cfb_player_box release into verified FBS game/player rows.

OFFLINE, read-only staging. No downloads, provider calls, D1/R2 writes or authority.
Input: local player_box_{season}.parquet (or CSV), verified FBS team-ID CSV,
and date/identity game reference. Every output game joins on (ESPN game_id,
ESPN team_id). Athlete joins use numeric ESPN athlete_id, NEVER player name.

The file's raw 'category' rows are consolidated per athlete/game, and combined
ESPN strings such as '23/41' are parsed only by explicit category contracts.
Unmapped stat_1..stat_5 rows are quarantined, not interpreted as known stats.
The output CSV matches --player-csv in cfb-team-player-stat-staging.py.
A release's retrieval time is NOT a game's historical publication time.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import pathlib
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

DEFAULT_GAME_MEMBER="cfb-history-v2/cfb_team_game_advanced_2004_2026.csv"
ID=re.compile(r"^[0-9]{1,15}$")
META={"season","game_id","team_id","athlete_id","athlete_name","jersey","category"}
FIELDS={
 "passing": {
  "passingYards":"passing_yards","yardsPerPassAttempt":"yards_per_pass_attempt",
  "passingTouchdowns":"passing_td","interceptions":"passing_interceptions","adjQBR":"adjusted_qbr",
 },
 "rushing": {
  "rushingAttempts":"rushing_attempts","rushingYards":"rushing_yards",
  "yardsPerRushAttempt":"yards_per_rush_attempt","rushingTouchdowns":"rushing_td",
  "longRushing":"long_rushing",
 },
 "receiving":{
  "receptions":"receptions","receivingYards":"receiving_yards",
  "yardsPerReception":"yards_per_reception","receivingTouchdowns":"receiving_td",
  "longReception":"long_reception",
 },
 "defensive":{
  "totalTackles":"total_tackles","soloTackles":"solo_tackles","sacks":"sacks",
  "tacklesForLoss":"tackles_for_loss","passesDefended":"passes_defended",
  "hurries":"hurries","defensiveTouchdowns":"defensive_td",
  "interceptions":"defensive_interceptions","interceptionYards":"interception_return_yards",
  "interceptionTouchdowns":"interception_td",
 },
 "fumbles":{"fumbles":"fumbles","fumblesLost":"fumbles_lost",
            "fumblesRecovered":"fumbles_recovered"},
 "kickReturns":{
  "kickReturns":"kick_returns","kickReturnYards":"kick_return_yards",
  "yardsPerKickReturn":"yards_per_kick_return","longKickReturn":"long_kick_return",
  "kickReturnTouchdowns":"kick_return_td",
 },
 "kicking":{"fieldGoalPct":"field_goal_pct","longFieldGoalMade":"long_field_goal",
            "totalKickingPoints":"kicking_points"},
 "punting":{"punts":"punts","puntYards":"punt_yards","grossAvgPuntYards":"gross_avg_punt_yards",
            "touchbacks":"touchbacks","puntsInside20":"punts_inside_20","longPunt":"long_punt"},
 "puntReturns":{"puntReturns":"punt_returns","puntReturnYards":"punt_return_yards",
  "yardsPerPuntReturn":"yards_per_punt_return","longPuntReturn":"long_punt_return",
  "puntReturnTouchdowns":"punt_return_td"},
}
CATEGORY_ALIASES={
 "passing":"passing","rushing":"rushing","receiving":"receiving",
 "defensive":"defensive","defense":"defensive",
 "fumbles":"fumbles","fumble":"fumbles",
 "kickreturns":"kickReturns","kickreturn":"kickReturns",
 "kicking":"kicking","punting":"punting",
 "puntreturns":"puntReturns","puntreturn":"puntReturns",
}
COMBINED={
 "passing":{"completions/passingAttempts":("completions","passing_attempts")},
 "kicking":{"fieldGoalsMade/fieldGoalAttempts":("field_goals_made","field_goal_attempts"),
            "extraPointsMade/extraPointAttempts":("extra_points_made","extra_point_attempts")},
}
def parse_time(raw):
 if not raw:raise ValueError("missing timestamp")
 dt=datetime.fromisoformat(str(raw).replace("Z","+00:00"))
 if dt.tzinfo is None:raise ValueError("timestamp missing timezone")
 return dt.astimezone(timezone.utc).isoformat().replace("+00:00","Z")
def numeric(v):
 if isinstance(v,bool) or v is None or str(v).strip()=="":return None
 try:
  n=float(v)
  return n if math.isfinite(n) else None
 except(ValueError,TypeError):return None
def fixed_pair(raw):
 if raw is None:return None
 m=re.fullmatch(r"\s*(\d+)\s*/\s*(\d+)\s*",str(raw))
 return (int(m.group(1)),int(m.group(2))) if m else None
def asset_rows(path,member=None):
 path=pathlib.Path(path)
 if path.suffix.lower()==".zip":
  if not member:raise ValueError("ZIP requires member")
  with zipfile.ZipFile(path) as z:
   with z.open(member) as stream:
    yield from csv.DictReader(io.TextIOWrapper(stream,encoding="utf-8-sig",newline=""))
 elif path.suffix.lower()==".parquet":
  try:
   import pyarrow.parquet as pq
  except ImportError as exc:
   raise RuntimeError("Install pyarrow to read local parquet; no auto-download") from exc
  pf=pq.ParquetFile(path)
  for batch in pf.iter_batches(batch_size=16000):
   for row in batch.to_pylist():yield row
 else:
  with path.open("r",encoding="utf-8-sig",newline="") as f:
   yield from csv.DictReader(f)
def fbs_ids(path):
 result=set()
 with open(path,encoding="utf-8-sig",newline="") as f:
  for row in csv.DictReader(f):
   raw=str(row.get("team_id","")).replace("cfb:espn:","").strip()
   if ID.fullmatch(raw) and (not row.get("subdivision") or row["subdivision"]=="FBS"):
    result.add(raw)
 if not result:raise ValueError("FBS whitelist is empty; fail closed")
 return result
def game_lookup(path,member,season):
 games={}
 for row in asset_rows(path,member):
  if str(row.get("season"))!=str(season):continue
  gid=str(row.get("game_id") or "")
  team=str(row.get("team_id") or "")
  if not ID.fullmatch(gid) or not ID.fullmatch(team):continue
  try:date=parse_time(row.get("game_date"))
  except(ValueError,TypeError):continue
  key=(gid,team)
  if key in games and games[key][0]!=date:raise ValueError("conflicting source game timestamp")
  games[key]=(date,row.get("opponent_name") or "")
 return games

def from_completed_schedule(path,season):
 """ESPN SDV schedule is one row/game and carries start_date and both team IDs.
 Strictly no incomplete/cancelled/TBD rows in a *performance* ledger.
 """
 games={}
 n={"excluded_incomplete":0,"missing_ids_or_start":0,"accepted":0}
 for r in asset_rows(path):
  if str(r.get("season"))!=str(season):continue
  gid=str(r.get("game_id") or "")
  home=str(r.get("home_id") or "")
  away=str(r.get("away_id") or "")
  completed=str(r.get("completed") or "").strip().lower() in ("true","1")
  tbd=str(r.get("start_time_tbd") or "").strip().lower() in ("true","1")
  status=str(r.get("status") or "").upper()
  if not completed or tbd or any(x in status for x in ("CANCEL","POSTPONE","SCHEDULE")):
   n["excluded_incomplete"]+=1;continue
  if not ID.fullmatch(gid) or not ID.fullmatch(home) or not ID.fullmatch(away):
   n["missing_ids_or_start"]+=1;continue
  try:date=parse_time(r.get("start_date"))
  except(ValueError,TypeError):
   n["missing_ids_or_start"]+=1;continue
  for key,opponent in [((gid,home),r.get("away_team") or ""),
                        ((gid,away),r.get("home_team") or "")]:
   if key in games and games[key][0]!=date:
    raise ValueError("conflicting completed schedule game date")
   games[key]=(date,opponent)
  n["accepted"]+=1
 return games,n

def converted(source,category):
 # Keep ONLY semantically named stats from ESPN's agreed category.
 metrics={}
 for original,output in FIELDS.get(category,{}).items():
  n=numeric(source.get(original))
  if n is not None:metrics[output]=n
 for original,(left,right) in COMBINED.get(category,{}).items():
  pair=fixed_pair(source.get(original))
  if pair:metrics[left],metrics[right]=pair
 return metrics
def build(args):
 observed=parse_time(args.source_observed_at)
 allowed=fbs_ids(args.fbs_teams)
 games,scheduleQa=from_completed_schedule(args.schedule,args.season) if args.schedule else (
   game_lookup(args.team_games,args.team_game_member,args.season),{"source":"team_game_archive"})
 grouped={}
 count=defaultdict(int)
 bad=set()
 for source in asset_rows(args.player_box,args.player_box_member):
  if str(source.get("season"))!=str(args.season):continue
  team=str(source.get("team_id") or "")
  athlete=str(source.get("athlete_id") or "")
  game=str(source.get("game_id") or "")
  if team not in allowed:count["excluded_non_fbs"]+=1;continue
  if not ID.fullmatch(athlete) or not ID.fullmatch(game):
   count["bad_identifiers"]+=1;continue
  key=(game,team)
  if key not in games:
   count["missing_game_date"]+=1;continue
  date,opp=games[key]
  if date>observed:
   count["future_game"]+=1;continue
  catKey=re.sub(r"[^a-z]","",str(source.get("category") or "").lower())
  cat=CATEGORY_ALIASES.get(catKey)
  if not cat:
   count["unmapped_category"]+=1;continue
  if any(source.get("stat_"+str(n)) not in (None,"") for n in range(1,6)):
   count["unnamed_stats_quarantined"]+=1
   continue
  metrics=converted(source,cat)
  if not metrics:
   count["no_named_metrics"]+=1;continue
  group_key=(game,team,athlete)
  rec=grouped.setdefault(group_key,{"game_id":game,"season":args.season,
    "game_date":date,"team_id":team,"athlete_id":athlete,"opponent":opp})
  for m,v in metrics.items():
   if m in rec and rec[m]!=v:
    bad.add(group_key)
    count["conflicting_measurement_rows"]+=1
   rec[m]=v
  count["accepted_category_rows"]+=1
 rows=[r for key,r in sorted(grouped.items()) if key not in bad]
 count["discarded_player_games_conflicts"]=len(bad)
 count["unique_player_games"]=len(rows)
 fieldnames=["game_id","season","game_date","team_id","athlete_id","opponent"]
 extra=sorted(set(k for r in rows for k in r if k not in fieldnames))
 return rows,fieldnames+extra,dict(count),len(allowed),observed,scheduleQa
def run(argv=None):
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument("--player-box",required=True)
 p.add_argument("--player-box-member")
 p.add_argument("--team-games",help="Offline completed team-game advanced CSV or ZIP")
 p.add_argument("--schedule",help="SDV espn_cfb_schedules/cfb_schedule_{season}.csv (completed games only)")
 p.add_argument("--team-game-member",default=DEFAULT_GAME_MEMBER)
 p.add_argument("--fbs-teams",required=True)
 p.add_argument("--source-observed-at",required=True)
 p.add_argument("--season",type=int,required=True)
 p.add_argument("--output-prefix",required=True)
 args=p.parse_args(argv)
 if bool(args.schedule)==bool(args.team_games):
  p.error("Exactly one of --schedule (SDV release) or --team-games (archive) is required")
 rows,fields,counts,fbsCount,observed,scheduleQa=build(args)
 out=pathlib.Path(args.output_prefix)
 out.parent.mkdir(parents=True,exist_ok=True)
 dest=pathlib.Path(str(out)+".player-game.csv")
 with dest.open("w",encoding="utf8",newline="") as f:
  writer=csv.DictWriter(f,fieldnames=fields)
  writer.writeheader();writer.writerows(rows)
 fileHash=hashlib.sha256(dest.read_bytes()).hexdigest()
 manifest={
  "season":args.season,"source":"SDV_ESPN_CFB_PLAYER_BOX",
  "asset":"espn_cfb_player_box/player_box_"+str(args.season)+".parquet",
  "source_observed_at":observed,"source_publication_time_verified":False,
  "temporal_class":"POSTGAME_OBSERVED_NOT_HISTORICAL_PIT",
  "fbs_whitelisted_teams":fbsCount,"counts":counts,
  "schedule_qa":scheduleQa,"game_date_reference":"SDV_COMPLETED_SCHEDULE" if args.schedule else "OFFLINE_TEAM_GAME_ARCHIVE",
  "player_game_rows":len(rows),"output":str(dest),"sha256":fileHash,
  "feature_authority":False,"betting_authority":False,
  "required_next_step":"verify player-game rows vs ESPN box, publisher refresh coverage, then immutable D1 import gate",
 }
 manifestFile=pathlib.Path(str(out)+".manifest.json")
 manifestFile.write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n",encoding="utf8")
 print(json.dumps(manifest,indent=2,sort_keys=True))
if __name__=="__main__":run()
