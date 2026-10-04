#!/usr/bin/env python3
"""SportsDataverse incremental acquisition probe.
Writes only canonical manifests/samples; duplicate upstream families are excluded by policy.
This job is intentionally research/snapshot-only. Model activation requires temporal validation.
"""
import json, os, sys
from datetime import datetime, timezone

SEASON=int(os.getenv("SDV_SEASON", datetime.now(timezone.utc).year))
OUT=os.getenv("SDV_OUT","artifacts/sdv-incremental-manifest.json")
rows=[]

def record(sport,family,status,count=0,columns=None,error=None):
    rows.append({"sport":sport,"family":family,"status":status,"records":int(count or 0),
                 "columns":sorted(list(columns or []))[:250],"error":str(error)[:300] if error else None})

def frame_call(sport,family,fn,*args,**kwargs):
    try:
        x=fn(*args,**kwargs)
        cols=getattr(x,"columns",[]) or []
        n=getattr(x,"height",None)
        if n is None:
            try:n=len(x)
            except:n=0
        record(sport,family,"AVAILABLE" if n else "AVAILABLE_EMPTY",n,cols)
    except Exception as e:
        record(sport,family,"UNAVAILABLE",0,[],e)

try:
    import sportsdataverse.nfl as nfl
    for typ in ("passing","rushing","receiving"):
        frame_call("nfl","nextgen_"+typ,nfl.load_nfl_nextgen_stats,[SEASON],stat_type=typ)
    for family,name in (("snap_counts","load_nfl_snap_counts"),("depth_charts","load_nfl_depth_charts"),
                        ("injuries","load_nfl_injuries"),("participation","load_nfl_pbp_participation"),
                        ("pfr_advanced","load_nfl_pfr_advstats"),("qbr","load_nfl_espn_qbr")):
        fn=getattr(nfl,name,None)
        if fn: frame_call("nfl",family,fn,[SEASON])
        else: record("nfl",family,"FUNCTION_MISSING")
except Exception as e: record("nfl","module","UNAVAILABLE",error=e)

try:
    import sportsdataverse.wnba as w
    for family,name in (("player_box","load_wnba_player_boxscore"),("team_box","load_wnba_team_boxscore"),
                        ("player_season","load_wnba_player_season_stats"),("pbp","load_wnba_pbp"),
                        ("shots","load_wnba_shots"),("schedule","load_wnba_schedule")):
        fn=getattr(w,name,None)
        if fn: frame_call("wnba",family,fn,[SEASON])
        else: record("wnba",family,"FUNCTION_MISSING")
except Exception as e: record("wnba","module","UNAVAILABLE",error=e)

# NCAA/NHL/soccer surfaces are registered for controlled adapter work, but do not
# guess signatures here. The package is introspected so API drift is visible.
for sport,module_name,prefixes in [
    ("cfb","sportsdataverse.cfb",("cfb_ncaa_","ncaa_")),
    ("cbb","sportsdataverse.mbb",("ncaa_mbb_","espn_mbb_")),
    ("nhl","sportsdataverse.nhl",("nhl_edge_","nhl_web_")),
    ("soccer","sportsdataverse.soccer",("espn_soccer_",)),
]:
    try:
        mod=__import__(module_name,fromlist=["*"])
        funcs=[n for n in dir(mod) if any(n.startswith(p) for p in prefixes)]
        record(sport,"adapter_surface","AVAILABLE",len(funcs),funcs)
    except Exception as e: record(sport,"adapter_surface","UNAVAILABLE",error=e)

manifest={"ok":any(r["status"]=="AVAILABLE" for r in rows),"generatedAt":datetime.now(timezone.utc).isoformat(),
          "season":SEASON,"package":"sportsdataverse","policy":"incremental-only; duplicate upstream lineages excluded",
          "families":rows}
os.makedirs(os.path.dirname(OUT) or ".",exist_ok=True)
with open(OUT,"w") as f: json.dump(manifest,f,indent=2)
print(json.dumps(manifest,indent=2))
sys.exit(0 if manifest["ok"] else 2)
