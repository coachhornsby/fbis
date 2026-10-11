#!/usr/bin/env python3
"""Normalize local SDV ESPN 2026 team box-score observations to FBS team-game CSV.

Read-only offline. Match numeric ESPN team+game IDs to FINAL SDV schedule, verified
2026 FBS whitelist. No acquired pregame PIT publication time, no model/wager
authority. Output formatted for --archive in cfb-team-player-stat-staging.py.
"""
import argparse
import csv
import hashlib
import json
import pathlib
import re
from collections import defaultdict
from importlib.machinery import SourceFileLoader

ID=re.compile(r"^[0-9]{1,15}$")
RATIO=re.compile(r"^\s*(\d+)\s*[-/]\s*(\d+)\s*$")
CLOCK=re.compile(r"^\s*(\d{1,3}):([0-5]\d)\s*$")
FBS_ROWS={
 "firstDowns":"off_first_downs_created",
 "totalYards":"off_total_yards",
 "netPassingYards":"off_pass_yards",
 "yardsPerPass":"off_yards_per_pass_attempt",
 "rushingYards":"off_rush_yards",
 "rushingAttempts":"off_rushes",
 "yardsPerRushAttempt":"off_yards_per_rush_attempt",
 "turnovers":"to_turnovers",
 "fumblesLost":"to_fumbles_lost",
 "interceptions":"to_interceptions_thrown",
}
def n(v):
 if v is None or v=="":return None
 try:
  f=float(v)
  if f!=f or abs(f)==float("inf"):return None
  return int(f) if f.is_integer() else f
 except(ValueError,TypeError):return None
def pair(raw):
 if not raw:return None
 m=RATIO.fullmatch(str(raw))
 return (int(m[1]),int(m[2])) if m else None
def minutes(raw):
 m=CLOCK.fullmatch(str(raw or ""))
 return round(int(m[1])+int(m[2])/60,6) if m else None
def sha(path):return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def normalize(args):
 adapter=SourceFileLoader("cfb_sdv_player_box",str(pathlib.Path(__file__).with_name(
    "cfb-sdv-player-box-normalize.py"))).load_module()
 fbs=adapter.fbs_ids(args.fbs_teams)
 games,qa=adapter.from_completed_schedule(args.schedule,args.season)
 # Game-side identity and source-fact validation: no names as joins.
 metadata={}
 with open(args.schedule,encoding="utf-8-sig",newline="") as f:
  for row in csv.DictReader(f):
   gid=str(row.get("game_id") or "")
   for side in ("home","away"):
    tid=str(row.get(side+"_id") or "")
    if gid and tid and (gid,tid) in games:
     other="away" if side=="home" else "home"
     score=n(row.get(side+"_score"))
     opponent_score=n(row.get(other+"_score"))
     metadata[(gid,tid)]={"home_away":side,"points_for":score,"points_against":opponent_score,
       "opponent_id":str(row.get(other+"_id") or "")}
 out=[];reject=defaultdict(int);seen=set();asof=adapter.parse_time(args.source_observed_at)
 for raw in adapter.asset_rows(args.team_box):
  if str(raw.get("season"))!=str(args.season):continue
  team=str(raw.get("team_id") or "")
  game=str(raw.get("game_id") or "")
  if team not in fbs:
   reject["non_fbs"]+=1;continue
  if not ID.fullmatch(game) or not ID.fullmatch(team) or (game,team) not in games:
   reject["not_final_or_unmatched"]+=1;continue
  date,opponent=games[(game,team)]
  if date>asof:
   reject["future_game"]+=1;continue
  meta=metadata.get((game,team))
  if not meta or raw.get("home_away")!=meta["home_away"] or meta["points_for"] is None:
   reject["side_or_score_inconsistent"]+=1;continue
  if (game,team) in seen:
   reject["duplicate_team_game"]+=1;continue
  seen.add((game,team))
  values={
   "game_id":game,"season":args.season,"game_date":date,"team_id":team,
   "opponent_id":meta["opponent_id"],"opponent_name":opponent,
   "points_for":meta["points_for"],"points_against":meta["points_against"],
  }
  for key,target in FBS_ROWS.items():
   value=n(raw.get(key))
   if value is not None:values[target]=value
  for column,done,attempts in [
   ("completionAttempts","off_completions","off_passes"),
   ("thirdDownEff","situ_third_down_conversions","situ_third_down_attempts"),
   ("fourthDownEff","situ_fourth_down_conversions","situ_fourth_down_attempts"),
   ("totalPenaltiesYards","situ_penalties","situ_penalty_yards")]:
   val=pair(raw.get(column))
   if val is not None:
    completed,total=val
    if completed<=total or column=="totalPenaltiesYards":
     values[done]=completed;values[attempts]=total
    else:reject["malformed_ratio"]+=1
   elif raw.get(column) not in (None,""):reject["malformed_ratio"]+=1
  time=minutes(raw.get("possessionTime"))
  if time is not None:values["situ_possession_minutes"]=time
  elif raw.get("possessionTime") not in (None,""):reject["malformed_clock"]+=1
  out.append(values)
 names=["game_id","season","game_date","team_id","opponent_id","opponent_name",
        "points_for","points_against"]
 return sorted(out,key=lambda r:(r["team_id"],r["game_id"])),names+sorted(
  {key for rec in out for key in rec if key not in names}),dict(reject),len(fbs),qa,asof

def run():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument("--team-box",required=True)
 p.add_argument("--schedule",required=True)
 p.add_argument("--fbs-teams",required=True)
 p.add_argument("--season",type=int,required=True)
 p.add_argument("--source-observed-at",required=True)
 p.add_argument("--output-prefix",required=True)
 args=p.parse_args()
 rows,fields,reject,fbs,qa,asof=normalize(args)
 output=pathlib.Path(args.output_prefix)
 output.parent.mkdir(parents=True,exist_ok=True)
 csvPath=pathlib.Path(str(output)+".team-game.csv")
 with csvPath.open("w",encoding="utf-8",newline="") as f:
  writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(rows)
 manifest={"source":"SDV_ESPN_CFB_TEAM_BOX","season":args.season,
  "source_observed_at":asof,"source_publication_time_verified":False,
  "temporal_class":"POSTGAME_OBSERVED_NOT_HISTORICAL_PIT",
  "fbs_whitelisted_teams":fbs,"source_schedule_qa":qa,
  "row_count":len(rows),"distinct_team_ids":len(set(r["team_id"] for r in rows)),
  "distinct_game_ids":len(set(r["game_id"] for r in rows)),
  "rejections":reject,
  "input_sha256":{"team_box":sha(args.team_box),"schedule":sha(args.schedule),
    "fbs_teams":sha(args.fbs_teams)},
  "output":str(csvPath),"sha256":sha(csvPath),
  "can_influence_projection":False,"can_authorize_wager":False}
 pathlib.Path(str(output)+".manifest.json").write_text(json.dumps(manifest,sort_keys=True,indent=2)+"\n")
 print(json.dumps(manifest,sort_keys=True,indent=2))
if __name__=="__main__":run()
