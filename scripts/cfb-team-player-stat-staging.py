#!/usr/bin/env python3
"""Offline CFB team/player statistical ledger STAGING ONLY.

Never calls providers, D1/R2 or GitHub. Never writes production data. All historical
records are postgame research observations, NOT pregame PIT-qualified model inputs.

Usage:
 python scripts/cfb-team-player-stat-staging.py \
  --archive cfb-full-history-v3.zip \
  --archive-observed-at 2026-10-02T14:11:00Z \
  --season 2026 --output-prefix /tmp/cfb-stats
Optional normalized player-game CSV:
 --player-csv /path/to/verified_player_game.csv

Player CSV requires ESPN numeric team_id/athlete_id, game_id, game_date and
season, plus numeric statistical columns. Never join players by name.
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

ARCHIVE_MEMBER="cfb-history-v2/cfb_team_game_advanced_2004_2026.csv"
TEAM_PREFIXES={"off_":"offense","def_":"defense","situ_":"situational",
               "drive_":"drives","to_":"turnovers","qb_":"quarterback"}
PLAYER_PREFIXES={"pass_":"passing","passing_":"passing","rush_":"rushing",
                 "rushing_":"rushing","rec_":"receiving","receiving_":"receiving",
                 "def_":"defense","kick_":"kicking","punt_":"punting",
                 "return_":"returning","special_":"special_teams"}
SKIP={"game_id","season","week","game_date","team_id","opponent_id",
      "team_name","opponent_name","side","player_id","athlete_id",
      "player_name","full_name","position","opponent","team",
      "source_timestamp"}
ADDITIVE={
 "points_for":"pointsFor","points_against":"pointsAgainst",
 "off_passes":"passAttempts","off_pass_yards":"passYards",
 "off_rushes":"rushAttempts","off_rush_yards":"rushYards",
 "off_scrimmage_plays":"scrimmagePlays",
 "def_sacks":"sacks","def_TFL":"tacklesForLoss",
 "to_turnovers":"turnovers","drive_drives":"drives",
 "off_first_downs_created":"firstDowns",
}
def iso(value):
 if value is None or not str(value).strip():raise ValueError("timestamp required")
 raw=str(value).strip().replace("Z","+00:00")
 dt=datetime.fromisoformat(raw)
 if dt.tzinfo is None: raise ValueError("timestamp lacks timezone: "+str(value))
 return dt.astimezone(timezone.utc).isoformat().replace("+00:00","Z")
def number(raw):
 if raw is None or raw=="" or isinstance(raw,bool):return None
 try:
  x=float(raw)
  return x if math.isfinite(x) else None
 except(ValueError,TypeError):return None
def canonical(raw,prefix):
 val=str(raw or "").strip()
 if val.startswith(prefix+":") and re.fullmatch(re.escape(prefix)+r":\d+",val):return val
 return prefix+":"+val if re.fullmatch(r"\d{1,15}",val) else None
def grouped_metrics(row,prefixes):
 groups={}
 for key,raw in row.items():
  if key in SKIP or not key:continue
  n=number(raw)
  if n is None:continue
  family=next((name for prefix,name in prefixes.items() if key.startswith(prefix)),"advanced")
  groups.setdefault(family,{})[key]=n
 return groups
def content_hash(obj):
 return hashlib.sha256(json.dumps(obj,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
def write_jsonl(path,rows):
 with open(path,"w",encoding="utf8") as f:
  for row in rows:f.write(json.dumps(row,sort_keys=True,separators=(",",":"))+"\n")
 return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def dataset_rows(path,member):
 p=pathlib.Path(path)
 if p.suffix.lower()==".zip":
  with zipfile.ZipFile(p) as z:
   with z.open(member) as raw:
    yield from csv.DictReader(io.TextIOWrapper(raw,encoding="utf-8-sig",newline=""))
 else:
  with p.open("r",encoding="utf-8-sig",newline="") as f:
   yield from csv.DictReader(f)
def verified_team_source(args):
 if not args.team_manifest:return None
 data=json.loads(pathlib.Path(args.team_manifest).read_text())
 digest=hashlib.sha256(pathlib.Path(args.archive).read_bytes()).hexdigest()
 if data.get("source")!="SDV_ESPN_CFB_TEAM_BOX" or data.get("sha256")!=digest:
  raise ValueError("team box source manifest/hash mismatch")
 if data.get("season")!=args.season or data.get("source_publication_time_verified") is not False:
  raise ValueError("team box season/publication contract mismatch")
 return data

def team_records(args,as_of):
 team_manifest=verified_team_source(args)
 team_asof=iso(team_manifest["source_observed_at"]) if team_manifest else as_of
 if team_asof>as_of:raise ValueError("team box observed after staging cutoff")
 team_source=team_manifest["source"] if team_manifest else "FBIS_SDV_CFBD_HISTORY_ARCHIVE"
 temporal="POSTGAME_OBSERVED_NOT_HISTORICAL_PIT" if team_manifest else "POSTGAME_ARCHIVE_NOT_PIT"
 out=[]
 seen=set()
 rejected=0
 for source in dataset_rows(args.archive,args.member):
  if source.get("season")!=str(args.season):continue
  team_id=canonical(source.get("team_id"),"cfb:espn")
  game_id=str(source.get("game_id") or "").strip()
  try:game_at=iso(source.get("game_date"))
  except(ValueError,TypeError):rejected+=1;continue
  if not team_id or not game_id or game_at>as_of:
   rejected+=1;continue
  key=(team_id,game_id)
  if key in seen: rejected+=1;continue
  seen.add(key)
  metrics=grouped_metrics(source,TEAM_PREFIXES)
  for field in ("points_for","points_against"):
   value=number(source.get(field))
   if value is not None:metrics.setdefault("scoring",{})[field]=value
  if not any(metrics.values()):rejected+=1;continue
  h=content_hash(metrics)
  out.append({
   "id":"cfb-team-game:"+content_hash([team_id,game_id,h])[:32],
   "team_id":team_id,"game_id":game_id,"season":args.season,
   "opponent":source.get("opponent_name") or None,
   "opponent_team_id":canonical(source.get("opponent_id"),"cfb:espn"),
   "game_at":game_at,"source":team_source,
   "source_timestamp":None,"observed_at":team_asof,"content_hash":h,
   "temporal_class":temporal,
   "metrics_json":json.dumps(metrics,sort_keys=True,separators=(",",":")),
   "ingested_at":None,"can_influence_projection":0,
  })
 return out,rejected
def partial_team_season(records,as_of):
 buckets=defaultdict(list)
 for record in records:buckets[(record["team_id"],record["season"])].append(record)
 output=[]
 for (team_id,season),rows in sorted(buckets.items()):
  totals={}
  cover={}
  for row in rows:
   original=json.loads(row["metrics_json"])
   flat={**original.get("scoring",{})}
   for family in original.values():flat.update(family)
   for original_name,out_name in ADDITIVE.items():
    n=number(flat.get(original_name))
    if n is None:continue
    totals[out_name]=totals.get(out_name,0.0)+n
    cover[out_name]=cover.get(out_name,0)+1
  if not totals:continue
  metrics={"partial_season_totals":totals,
           "stat_observation_counts":cover,
           "coverage":{"source_games_included":len(rows)}}
  ids=sorted(row["game_id"] for row in rows)
  h=content_hash([metrics,ids])
  output.append({
   "id":"cfb-team-season:"+content_hash([team_id,season,h])[:32],
   "team_id":team_id,"season":season,"source":rows[0]["source"],
   "source_timestamp":None,"observed_at":rows[0]["observed_at"],"content_hash":h,
   "metrics_json":json.dumps(metrics,sort_keys=True,separators=(",",":")),
   "source_game_ids_json":json.dumps(ids),
   "ingestion_version":"cfb-stat-staging-v1",
   "can_influence_projection":0,
  })
 return output
def verified_player_source(args):
 # Admission requires an exact manifest and byte hash from our SDV player-box adapter.
 if not args.player_csv or not args.player_manifest:
  return None
 manifest=json.loads(pathlib.Path(args.player_manifest).read_text())
 digest=hashlib.sha256(pathlib.Path(args.player_csv).read_bytes()).hexdigest()
 if manifest.get("source")!="SDV_ESPN_CFB_PLAYER_BOX" or manifest.get("sha256")!=digest:
  raise ValueError("player box source manifest/hash mismatch")
 if manifest.get("season")!=args.season:
  raise ValueError("player box season does not match stage season")
 if manifest.get("source_publication_time_verified") is not False:
  raise ValueError("unexpected player box publication state")
 return manifest

def player_records(args,as_of):
 if not args.player_csv:return [],0
 source_manifest=verified_player_source(args)
 if not source_manifest:
  # Do not import unknown player game CSVs into a source-specific archive.
  raise ValueError("--player-manifest required for player game statistics")
 player_observed_at=iso(source_manifest["source_observed_at"])
 if player_observed_at>as_of:
  raise ValueError("player source observed after archive stage cutoff")
 out=[];seen=set();rejected=0
 for source in dataset_rows(args.player_csv,args.member):
  if source.get("season")!=str(args.season):continue
  team_id=canonical(source.get("team_id"),"cfb:espn")
  player_id=canonical(source.get("athlete_id") or source.get("player_id"),"cfb:espn-player")
  game_id=str(source.get("game_id") or "").strip()
  try:game_at=iso(source.get("game_date"))
  except(ValueError,TypeError):rejected+=1;continue
  if not team_id or not player_id or not game_id or game_at>as_of:
   rejected+=1;continue
  key=(player_id,game_id)
  if key in seen:rejected+=1;continue
  seen.add(key)
  metrics=grouped_metrics(source,PLAYER_PREFIXES)
  if not any(metrics.values()):rejected+=1;continue
  h=content_hash(metrics)
  out.append({
   "id":"cfb-player-game:"+content_hash([team_id,player_id,game_id,h])[:32],
   "team_id":team_id,"player_id":player_id,"game_id":game_id,
   "season":args.season,"opponent":source.get("opponent") or None,
   "game_at":game_at,"source":source_manifest["source"],
   "source_timestamp":None,"observed_at":player_observed_at,"content_hash":h,
   "temporal_class":"POSTGAME_OBSERVED_NOT_HISTORICAL_PIT",
   "metrics_json":json.dumps(metrics,sort_keys=True,separators=(",",":")),
   "ingested_at":None,"can_influence_projection":0,
  })
 return out,rejected
PLAYER_ADDITIVE={
 "passing_yards":"passingYards","pass_yards":"passingYards",
 "pass_attempts":"passAttempts","passing_attempts":"passAttempts",
 "completions":"completions","rushing_yards":"rushingYards",
 "rush_yards":"rushingYards","rushing_attempts":"rushAttempts",
 "rush_attempts":"rushAttempts","receiving_yards":"receivingYards",
 "rec_yards":"receivingYards","receptions":"receptions",
 "targets":"targets","pass_td":"passTouchdowns","rushing_td":"rushTouchdowns",
 "receiving_td":"receivingTouchdowns","interceptions":"interceptions",
 "total_tackles":"totalTackles","solo_tackles":"soloTackles",
 "sacks":"sacks","tackles_for_loss":"tacklesForLoss",
 "passes_defended":"passesDefended","hurries":"hurries",
 "defensive_td":"defensiveTouchdowns","defensive_interceptions":"defensiveInterceptions",
 "interception_return_yards":"interceptionReturnYards","interception_td":"interceptionTouchdowns",
 "fumbles":"fumbles","fumbles_lost":"fumblesLost","fumbles_recovered":"fumblesRecovered",
 "field_goals_made":"fieldGoalsMade","field_goal_attempts":"fieldGoalAttempts",
 "extra_points_made":"extraPointsMade","extra_point_attempts":"extraPointAttempts",
 "punts":"punts","punt_yards":"puntYards",
 "kick_returns":"kickReturns","kick_return_yards":"kickReturnYards",
 "punt_returns":"puntReturns","punt_return_yards":"puntReturnYards",
}
def partial_player_season(records,as_of):
 buckets=defaultdict(list)
 for record in records:
  buckets[(record["team_id"],record["player_id"],record["season"])].append(record)
 output=[]
 for (team_id,player_id,season),rows in sorted(buckets.items()):
  totals={};counts={}
  for row in rows:
   obj=json.loads(row["metrics_json"])
   flat={}
   for family in obj.values():flat.update(family)
   found=set()
   for src,out in PLAYER_ADDITIVE.items():
    if out in found:continue
    n=number(flat.get(src))
    if n is None:continue
    totals[out]=totals.get(out,0)+n
    counts[out]=counts.get(out,0)+1
    found.add(out)
  if not totals:continue
  games=sorted(row["game_id"] for row in rows)
  metrics={"partial_season_totals":totals,"stat_observation_counts":counts,
           "coverage":{"source_games_included":len(rows)}}
  h=content_hash([metrics,games])
  output.append({
   "id":"cfb-player-season:"+content_hash([team_id,player_id,season,h])[:32],
   "team_id":team_id,"player_id":player_id,"season":season,
   "source":rows[0]["source"],"source_timestamp":None,
   "observed_at":rows[0]["observed_at"],"content_hash":h,
   "metrics_json":json.dumps(metrics,sort_keys=True,separators=(",",":")),
   "source_game_ids_json":json.dumps(games),
   "ingestion_version":"cfb-stat-staging-v1","can_influence_projection":0,
  })
 return output

def main(argv=None):
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument("--archive",help="Required except for --player-only research staging")
 parser.add_argument("--team-manifest",help="SHA-256 bound SDV team box manifest when --archive is a current box source")
 parser.add_argument("--player-only",action="store_true",help="Stage only manifest-verified player game/season rows")
 parser.add_argument("--member",default=ARCHIVE_MEMBER)
 parser.add_argument("--archive-observed-at",required=True)
 parser.add_argument("--season",type=int,default=2026)
 parser.add_argument("--player-csv")
 parser.add_argument("--player-manifest",help="Mandatory SDV player box adapter manifest if --player-csv supplied")
 parser.add_argument("--output-prefix",required=True)
 args=parser.parse_args(argv)
 if not args.player_only and not args.archive:
  parser.error("--archive required unless --player-only")
 if args.player_only and not args.player_csv:
  parser.error("--player-only requires --player-csv and --player-manifest")
 as_of=iso(args.archive_observed_at)
 games,rg=([],0) if args.player_only else team_records(args,as_of)
 seasons=partial_team_season(games,as_of)
 players,rp=player_records(args,as_of)
 player_seasons=partial_player_season(players,as_of)
 files={}
 prefix=pathlib.Path(args.output_prefix)
 prefix.parent.mkdir(parents=True,exist_ok=True)
 for name,rows in [("team-game",games),("team-season",seasons),("player-game",players),("player-season",player_seasons)]:
  file=pathlib.Path(str(prefix)+"."+name+".jsonl")
  files[name]={"path":str(file),"records":len(rows),"sha256":write_jsonl(file,rows)}
 manifest={
  "season":args.season,"archive_assembled_at":as_of,
  "temporal_class":"POSTGAME_ARCHIVE_NOT_PIT","model_authority":False,
  "can_authorize_wager":False,"source":"FBIS_SDV_CFBD_HISTORY_ARCHIVE",
  "source_publication_timestamp_verified":False,
  "team_rows_rejected":rg,"player_rows_rejected":rp,
  "player_source_manifest_verified":bool(args.player_csv and args.player_manifest),
  "team_source_manifest_verified":bool(args.archive and args.team_manifest),
  "files":files,
  "note":"Staging only; contains postgame historical evidence, not pregame forecasts or production data.",
 }
 pathlib.Path(str(prefix)+".manifest.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
 print(json.dumps(manifest,indent=2,sort_keys=True))
if __name__=="__main__":main()
