#!/usr/bin/env python3
"""Static historical source and contract inventory. Never downloads third-party datasets."""
import collections
import datetime
import json
import pathlib
import re

ROOT=pathlib.Path(__file__).resolve().parents[1]
EXCLUDE={".git","node_modules","dist",".wrangler","coverage"}
RULES={
 "SVD":r"sportsdataverse|sport[s]?dataverse|collegefootballverse|collegebasketballverse",
 "nflverse":r"nflverse|nflfastr|nflreadr",
 "MoneyPuck":r"moneypuck",
 "Retrosheet":r"retrosheet",
 "Tennis-Data":r"tennis-data\.co\.uk",
 "Football-Data":r"football-data\.co\.uk",
 "MatchCharting":r"tennis_MatchChartingProject|match.charting.project",
 "CFBD":r"CFBD_API_KEY|collegefootballdata|api\.collegefootballdata",
 "CBBD":r"CBBD_API_KEY|collegebasketballdata|api\.collegebasketballdata",
 "Apify":r"apify",
 "Action":r"action.network|actionnetwork|ACTION_APIFY",
 "PrizePicks":r"prizepicks",
}
patterns={k:re.compile(p,re.I) for k,p in RULES.items()}
counts=collections.defaultdict(lambda:{"files":0,"matches":0,"paths":[]})
files=0
for path in ROOT.rglob("*"):
 if not path.is_file() or any(p in EXCLUDE for p in path.relative_to(ROOT).parts):continue
 if path.suffix.lower() not in {".js",".mjs",".ts",".tsx",".json",".md",".yml",".yaml",".toml",".sql",".py"}:continue
 if path.stat().st_size>1_000_000:continue
 try: data=path.read_text(encoding="utf-8")
 except (UnicodeError,OSError):continue
 files+=1
 for name,pat in patterns.items():
  n=len(pat.findall(data))
  if n:
   counts[name]["files"]+=1
   counts[name]["matches"]+=n
   if len(counts[name]["paths"])<25:counts[name]["paths"].append(str(path.relative_to(ROOT)))
sources=[
 {"source":"MoneyPuck","sport":"NHL","status":"blocked_pending_permission","reason":"Noncommercial permission limit; no automatic download"},
 {"source":"Tennis-Data","sport":"Tennis","status":"blocked_by_terms","reason":"Site explicitly excludes AI and automated commercial use"},
 {"source":"Football-Data","sport":"Soccer","status":"blocked_by_terms","reason":"Site explicitly excludes AI and automated commercial use"},
 {"source":"Match Charting Project","sport":"Tennis","status":"research_only_pending_license","reason":"Noncommercial license"},
 {"source":"nflverse-data","sport":"NFL","status":"candidate_manual_rights_review","reason":"CC-BY-4.0 repository; NFL source rights separately governed"},
 {"source":"Retrosheet","sport":"MLB","status":"candidate_rights_review","reason":"Broad historic reuse statement; confirm current notice"},
 {"source":"March Machine Learning Mania","sport":"CBB","status":"competition_terms_review","reason":"Check competition dataset terms before FBIS use"},
 {"source":"FiveThirtyEight archive","sport":"Multiple","status":"archive_license_review","reason":"Per-dataset licensing and historical scope vary"},
 {"source":"SportsDataverse","sport":"Multiple","status":"existing_source_audit","reason":"Check dataset-level provenance and production completeness"},
]
report={"generated_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"scope":"repository source-code references only, NOT production D1/R2 coverage","files_scanned":files,"references":dict(counts),"source_decisions":sources,"production_season_counts":"not_measured","canonical_game_reconciliation":"not_measured","recommendation":"Do not import blocked sources or change champions/production authority"}
dest=ROOT/"audit-output"
dest.mkdir(exist_ok=True)
(dest/"historical-gap.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({"files_scanned":files,"references":{k:v["files"] for k,v in counts.items()},"report":str(dest/"historical-gap.json")},indent=2))
