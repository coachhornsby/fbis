#!/usr/bin/env python3
"""Bounded FBS source-observed postgame research import into approved D1 ledgers.

DOES NOT migrate schema, fetch providers, alter model scores or authorize wagers.
Defaults to --dry-run; --apply requires exact explicit release authorization,
successful 0099 dual-ledger preflight, a verified full-backup report, and full
2026 canonical athlete-team membership reconciliation. Restarts are idempotent.
"""
import argparse
import hashlib
import json
import os
import pathlib
import sys
import time
import urllib.request
import urllib.error
from collections import Counter

DB="b50c724c-903b-4241-8ce1-48d931e7a44c"
ACCOUNT="2fdc80b8d99070adcef12f7a785c3fc1"
TABLES={
 "team-game":("cfb_team_game_stat_observations",["id","team_id","game_id","season","opponent","game_at","source","source_timestamp","observed_at","content_hash","temporal_class","metrics_json","ingested_at","can_influence_projection"],745),
 "team-season":("cfb_team_season_stat_snapshots",["id","team_id","season","source","source_timestamp","observed_at","content_hash","metrics_json","source_game_ids_json","ingestion_version","can_influence_projection"],138),
 "player-game":("cfb_player_game_stat_observations",["id","team_id","player_id","game_id","season","opponent","game_at","source","source_timestamp","observed_at","content_hash","temporal_class","metrics_json","ingested_at","can_influence_projection"],26618),
 "player-season":("cfb_player_season_stat_snapshots",["id","team_id","player_id","season","source","source_timestamp","observed_at","content_hash","metrics_json","source_game_ids_json","ingestion_version","can_influence_projection"],7819),
}
QUARANTINE={("cfb:espn:2449","cfb:espn-player:5299519"),
            ("cfb:espn:2653","cfb:espn-player:5156174")}
def quote(value):
 if value is None:return "NULL"
 if isinstance(value,bool):return "1" if value else "0"
 if isinstance(value,(int,float)):return str(value)
 return "'"+str(value).replace("'","''")+"'"
def hashed_file(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
 return h.hexdigest()
def records(root):
 manifest=json.loads((root/"fbs-2026-ledger.manifest.json").read_text())
 output={}
 for name in TABLES:
  path=root/("fbs-2026-ledger."+name+".jsonl")
  expected=manifest["files"][name]
  if hashed_file(path)!=expected["sha256"]:raise RuntimeError("input hash mismatch "+name)
  data=[json.loads(line) for line in path.read_text().splitlines() if line.strip()]
  if len(data)!=expected["records"]:raise RuntimeError("source row mismatch "+name)
  clean=[]
  for row in data:
   if row.get("season")!=2026 or row.get("can_influence_projection")!=0:
    raise RuntimeError("incorrect source season or model authority")
   if row.get("source_timestamp") is not None:
    raise RuntimeError("historical first-seen timestamp misrepresented")
   if name.startswith("player") and (row["team_id"],row["player_id"]) in QUARANTINE:
    continue
   clean.append(row)
  if len(clean)!=TABLES[name][2]:raise RuntimeError("unqualified source count "+name)
  output[name]=clean
 return output
def api(sql):
 token=os.environ["CLOUDFLARE_API_TOKEN"]
 url="https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+"/d1/database/"+DB+"/query"
 req=urllib.request.Request(url,data=json.dumps({"sql":sql}).encode(),
  headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"},method="POST")
 for attempt in range(9):
  try:
   with urllib.request.urlopen(req,timeout=120) as response:result=json.load(response)
   if not result.get("success"):raise RuntimeError("D1 API returned non-success")
   if not result.get("result") or result["result"][0].get("success") is False:
    raise RuntimeError("D1 SQL error")
   return result["result"][0]
  except (urllib.error.HTTPError,urllib.error.URLError,RuntimeError,TimeoutError) as e:
   if isinstance(e,urllib.error.HTTPError) and e.code not in (429,500,502,503,504):
    raise
   if attempt==8:raise
   time.sleep(min(3*(attempt+1),20))
 raise RuntimeError("D1 retries exceeded")
def rows(sql):return api(sql).get("results") or []
def live_preflight():
 schema=rows("SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1")
 wrangler=rows("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
 if schema[0]["id"]!="0099_cfb_fbs_statistical_ledgers" or wrangler[0]["name"]!="0099_cfb_fbs_statistical_ledgers.sql":
  raise RuntimeError("0099 dual migration ledger not in production; STOP")
 expected={t[0] for t in TABLES.values()}
 existing={r["name"] for r in rows("SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+
    ",".join(quote(t) for t in sorted(expected))+")")}
 if existing!=expected:raise RuntimeError("production FBS research stat tables missing")
 fbs={r["team_id"] for r in rows("SELECT team_id FROM cfb_canonical_teams WHERE active=1 AND subdivision='FBS'")}
 if len(fbs)!=138:raise RuntimeError("canonical FBS scope drift")
 memberships=set()
 for offset in range(0,30000,1000):
  batch=rows("SELECT team_id,player_id FROM cfb_roster_membership WHERE season=2026 AND team_id IN "
    "(SELECT team_id FROM cfb_canonical_teams WHERE active=1 AND subdivision='FBS') "
    "LIMIT 1000 OFFSET "+str(offset))
  if not batch:break
  memberships.update((r["team_id"],r["player_id"]) for r in batch)
 if len(memberships)<14000:raise RuntimeError("canonical FBS roster coverage unexpectedly low")
 counts={name:rows("SELECT COUNT(*) AS n FROM "+table)[0]["n"] for name,(table,_,_) in TABLES.items()}
 return fbs,memberships,counts
def validate_data(staged,fbs,memberships):
 team_games={(r["team_id"],r["game_id"]) for r in staged["team-game"]}
 for name,data in staged.items():
  for r in data:
   if r["team_id"] not in fbs:raise RuntimeError("non-FBS source team")
   if name.startswith("player") and (r["team_id"],r["player_id"]) not in memberships:
    raise RuntimeError("unresolved canonical player identity")
   if name=="player-game" and (r["team_id"],r["game_id"]) not in team_games:
    raise RuntimeError("player-game missing from source team box")
   if r.get("observed_at")!="2026-10-11T00:53:00Z":
    raise RuntimeError("unexpected source observation time")
def backed_up(report_path):
 report=json.loads(pathlib.Path(report_path).read_text())
 if report.get("status")!="LOCAL_RESTORE_AND_R2_UPLOAD_COMPLETE" or report.get("database_id")!=DB:
  raise RuntimeError("verified full-backup rehearsal proof absent")
 if report.get("archive_bucket")!="fbis-archive" or not report.get("parts"):
  raise RuntimeError("private R2 backup archive proof absent")
 if report.get("snapshot",{}).get("migration_tip")!="0097_apify_acquisition_authority":
  raise RuntimeError("source backup is not pre-migration 0097")
 if not all(name in report.get("migration_rehearsal",[]) for name in
    ["0098_college_persistence_recovery","0099_cfb_fbs_statistical_ledgers"]):
  raise RuntimeError("migration recovery rehearsal unproven")
 return report["bookmark"]
def statement(name,rows_):
 table,columns,_=TABLES[name]
 values=[]
 for row in rows_:
  parts=[]
  for column in columns:
   value=("__NOW__" if column=="ingested_at" else row.get(column))
   parts.append("strftime('%Y-%m-%dT%H:%M:%fZ','now')" if value=="__NOW__" else quote(value))
  values.append("("+",".join(parts)+")")
 return "INSERT OR IGNORE INTO "+table+"("+",".join(columns)+") VALUES "+",".join(values)
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument("--source-dir",required=True)
 parser.add_argument("--backup-report")
 parser.add_argument("--apply",action="store_true")
 parser.add_argument("--batch-size",type=int,default=50)
 parser.add_argument("--report",default="/tmp/cfb-fbs-import-result.json")
 args=parser.parse_args()
 if not 1<=args.batch_size<=75:raise RuntimeError("batch size out of approved bounds")
 data=records(pathlib.Path(args.source_dir))
 if args.apply:
  if os.environ.get("CFB_FBS_IMPORT_RELEASE_APPROVED")!="yes-research-only-20261011":
   raise RuntimeError("production import requires exact release approval token")
  if os.environ.get("CLOUDFLARE_ACCOUNT_ID")!=ACCOUNT:
   raise RuntimeError("wrong production account")
  if not args.backup_report:raise RuntimeError("full backup proof is required")
  bookmark=backed_up(args.backup_report)
  fbs,memberships,initial=live_preflight()
  validate_data(data,fbs,memberships)
  for name,count in initial.items():
   if count>TABLES[name][2]:raise RuntimeError("pre-existing unexpected statistical data "+name)
  imported=Counter()
  for name,items in data.items():
   for offset in range(0,len(items),args.batch_size):
    batch=items[offset:offset+args.batch_size]
    api(statement(name,batch))
    imported[name]+=len(batch)
    if offset%1000<args.batch_size:
     print("idempotent insertion",name,imported[name],"/",len(items),flush=True)
  final={name:rows("SELECT COUNT(*) AS n FROM "+table)[0]["n"] for name,(table,_,_) in TABLES.items()}
  if any(final[name]!=TABLES[name][2] for name in TABLES):
   raise RuntimeError("postflight row counts differ from verified source")
  for name,(table,_,_) in TABLES.items():
   if rows("SELECT COUNT(*) AS n FROM "+table+" WHERE can_influence_projection<>0")[0]["n"]!=0:
    raise RuntimeError("wager/model authority guard violated")
  status="PRODUCTION_RESEARCH_IMPORT_VERIFIED"
 else:
  bookmark=None
  imported={}
  final={}
  status="OFFLINE_SOURCE_VALIDATED_PRODUCTION_UNCHANGED"
 result={"status":status,"database":DB,"backup_bookmark":bookmark,
  "expected":{name:spec[2] for name,spec in TABLES.items()},
  "quarantined_pairs":len(QUARANTINE),"source_research_only":True,
  "imported_attempts":dict(imported),"verified_final_counts":final}
 pathlib.Path(args.report).write_text(json.dumps(result,indent=2)+"\n")
 print(json.dumps(result,indent=2))
if __name__=="__main__":
 try:main()
 except Exception as e:
  print("CFB_FBS_IMPORT_STOP:"+str(e),file=sys.stderr)
  raise
