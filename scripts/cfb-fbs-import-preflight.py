#!/usr/bin/env python3
"""Read-only full 2026 FBS backfill identity and PIT/provenance reconciliation.
No production D1 writes. Output is an aggregate QA report, no roster names/IDs.
"""
import hashlib
import json
import os
import pathlib
import sys
import urllib.request
import urllib.error
import time
from collections import Counter

DB="b50c724c-903b-4241-8ce1-48d931e7a44c"
ACCOUNT="2fdc80b8d99070adcef12f7a785c3fc1"
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else ".")
token=os.environ["CLOUDFLARE_API_TOKEN"]
if os.environ["CLOUDFLARE_ACCOUNT_ID"]!=ACCOUNT:raise SystemExit("wrong Cloudflare account")
def query(sql):
 req=urllib.request.Request("https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+
 "/d1/database/"+DB+"/query",data=json.dumps({"sql":sql}).encode(),
 headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"},method="POST")
 for attempt in range(9):
  try:
   with urllib.request.urlopen(req,timeout=90) as response:r=json.load(response)
   if not r.get("success"):raise RuntimeError("D1 read failed: "+str(r.get("errors")))
   return r["result"][0]["results"]
  except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,RuntimeError) as e:
   if attempt>=8 or (isinstance(e,urllib.error.HTTPError) and e.code not in (429,500,502,503,504)):
    raise
   wait=min(2*(attempt+1),18)
   print("D1 read transient failure; retry",attempt+1,"in",wait,"seconds",flush=True)
   time.sleep(wait)
 raise RuntimeError("D1 query retries exhausted")
def rows(name):
 p=root/("fbs-2026-ledger."+name+".jsonl")
 h=hashlib.sha256()
 result=[]
 with p.open("rb") as f:
  for line in f:
   h.update(line)
   if line.strip():result.append(json.loads(line))
 return result,h.hexdigest()
manifest=json.loads((root/"fbs-2026-ledger.manifest.json").read_text())
stage={}
for name in ["team-game","team-season","player-game","player-season"]:
 arr,digest=rows(name)
 expected=manifest["files"][name]
 if len(arr)!=expected["records"] or digest!=expected["sha256"]:
  raise RuntimeError("source asset sha/count mismatch: "+name)
 stage[name]=arr
active={r["team_id"] for r in query("SELECT team_id FROM cfb_canonical_teams WHERE active=1 AND subdivision='FBS'")}
if len(active)!=138:raise RuntimeError("unexpected canonical FBS team count")
membership=set()
size=1000
for off in range(0,30000,size):
 lines=query("SELECT team_id,player_id FROM cfb_roster_membership "
   "WHERE season=2026 AND team_id IN "
   "(SELECT team_id FROM cfb_canonical_teams WHERE active=1 AND subdivision='FBS') "
   "LIMIT "+str(size)+" OFFSET "+str(off))
 if not lines:break
 membership.update((r["team_id"],r["player_id"]) for r in lines)
 print("read canonical FBS memberships",len(membership),flush=True)
if not membership:raise RuntimeError("canonical FBS membership unavailable")
scoped_games={(r["team_id"],str(r["game_id"])) for r in stage["team-game"]}
checks={}
for name,data in stage.items():
 bad=Counter()
 for row in data:
  team=row.get("team_id")
  if team not in active:bad["not_active_fbs"]+=1
  if row.get("can_influence_projection")!=0:bad["authority_nonzero"]+=1
  if row.get("source_timestamp") is not None:bad["unexpected_historical_pit_timestamp"]+=1
  if not str(row.get("observed_at") or "").startswith("2026-10-11T"):bad["unexpected_observation_time"]+=1
  if name.startswith("player"):
   pair=(team,row.get("player_id"))
   if pair not in membership:bad["missing_canonical_team_player_membership"]+=1
  if name=="player-game" and (team,str(row.get("game_id"))) not in scoped_games:
   bad["missing_source_team_game"]+=1
  if name=="team-season" or name=="player-season":
   if not row.get("source_game_ids_json"):bad["missing_source_game_lineage"]+=1
 checks[name]={"rows":len(data),"failures":dict(bad)}
report={"mode":"READ_ONLY_FULL_CANONICAL_RECONCILIATION",
 "source_manifest_sha256":hashlib.sha256((root/"fbs-2026-ledger.manifest.json").read_bytes()).hexdigest(),
 "fbs_teams":len(active),"canonical_fbs_player_memberships":len(membership),
 "checks":checks,"model_authority":False,
 "status":"PASS" if all(not data["failures"] for data in checks.values()) else "REJECT_NEEDS_QUARANTINE"}
out=root/"fbs-full-identity-reconciliation.json"
out.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report,indent=2))
if report["status"]!="PASS":sys.exit(3)
