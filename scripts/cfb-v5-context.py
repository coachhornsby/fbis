#!/usr/bin/env python3
"""Build leakage-safe CFB v5 context features and conference power rankings."""
from pathlib import Path
import json, math
import numpy as np, pandas as pd

SRC=Path("artifacts/cfb-final/cfb_training_full_enriched_2004_2026.csv")
OUT=Path("artifacts/cfb-final/v5-context"); OUT.mkdir(parents=True,exist_ok=True)

def n(x): return pd.to_numeric(x,errors="coerce")

def main():
 d=pd.read_csv(SRC,low_memory=False)
 d["season"]=n(d.season).astype("Int64"); d["week"]=n(d.week)
 d["actual_margin"]=n(d.home_score)-n(d.away_score)
 # Use only completed PRIOR games to construct schedule/conference state.
 teams={}
 conf={}
 rows=[]
 for season,sg in d.sort_values(["season","week","game_id"]).groupby("season",sort=True):
  teams={}; conf={}
  for week,wg in sg.groupby("week",sort=True):
   for _,r in wg.iterrows():
    h=str(r.home_id); a=str(r.away_id)
    hs=teams.get(h,{"rating":0.0,"games":0}); aas=teams.get(a,{"rating":0.0,"games":0})
    hc=str(r.get("home_conference","UNKNOWN")); ac=str(r.get("away_conference","UNKNOWN"))
    hconf=conf.get(hc,{"rating":0.0,"games":0}); aconf=conf.get(ac,{"rating":0.0,"games":0})
    neutral=bool(r.get("neutral_site",False))
    # Shrunk national HFA baseline; explicit zero on neutral sites.
    hfa=0.0 if neutral else 2.5
    # Opponent/SOS and conference values are pregame snapshots.
    rows.append({"game_id":r.game_id,
      "v5_home_sos":aas["rating"],"v5_away_sos":hs["rating"],
      "v5_diff_sos":aas["rating"]-hs["rating"],"v5_sum_sos":aas["rating"]+hs["rating"],
      "v5_home_conference_strength":hconf["rating"],"v5_away_conference_strength":aconf["rating"],
      "v5_diff_conference_strength":hconf["rating"]-aconf["rating"],
      "v5_sum_conference_strength":hconf["rating"]+aconf["rating"],
      "v5_hfa":hfa,
      "v5_home_games_prior":hs["games"],"v5_away_games_prior":aas["games"]})
   # update only AFTER every game in the week has been snapshotted
   for _,r in wg.iterrows():
    if pd.isna(r.home_score) or pd.isna(r.away_score): continue
    h=str(r.home_id); a=str(r.away_id); hc=str(r.get("home_conference","UNKNOWN")); ac=str(r.get("away_conference","UNKNOWN"))
    hs=teams.get(h,{"rating":0.0,"games":0}); aas=teams.get(a,{"rating":0.0,"games":0})
    neutral=bool(r.get("neutral_site",False)); hfa=0.0 if neutral else 2.5
    result=float(r.home_score)-float(r.away_score)-hfa
    exp=hs["rating"]-aas["rating"]; resid=float(np.clip(result-exp,-35,35)); k=.16
    teams[h]={"rating":hs["rating"]+k*resid/2,"games":hs["games"]+1}
    teams[a]={"rating":aas["rating"]-k*resid/2,"games":aas["games"]+1}
    # Conference rating is learned ONLY from cross-conference games; shrink via conservative k.
    if hc!=ac and hc!="UNKNOWN" and ac!="UNKNOWN":
      ch=conf.get(hc,{"rating":0.0,"games":0}); ca=conf.get(ac,{"rating":0.0,"games":0})
      cres=result-(ch["rating"]-ca["rating"]); ck=.06
      conf[hc]={"rating":ch["rating"]+ck*cres/2,"games":ch["games"]+1}
      conf[ac]={"rating":ca["rating"]-ck*cres/2,"games":ca["games"]+1}
 # merge context into canonical rows for v5 only
 x=pd.DataFrame(rows); out=d.merge(x,on="game_id",how="left")
 out.to_csv(OUT/"cfb_v5_context.csv",index=False)
 # Current conference ranking from latest season, replayed point-in-time.
 latest=int(d.season.dropna().max()); cur=d[d.season==latest].sort_values(["week","game_id"])
 cr={}
 for _,r in cur.iterrows():
  if pd.isna(r.home_score) or pd.isna(r.away_score): continue
  hc=str(r.get("home_conference","UNKNOWN")); ac=str(r.get("away_conference","UNKNOWN"))
  if hc==ac or "UNKNOWN" in (hc,ac): continue
  h=cr.get(hc,{"rating":0.0,"games":0}); a=cr.get(ac,{"rating":0.0,"games":0})
  hfa=0.0 if bool(r.get("neutral_site",False)) else 2.5
  result=float(r.home_score)-float(r.away_score)-hfa
  resid=float(np.clip(result-(h["rating"]-a["rating"]),-35,35)); k=.06
  cr[hc]={"rating":h["rating"]+k*resid/2,"games":h["games"]+1}; cr[ac]={"rating":a["rating"]-k*resid/2,"games":a["games"]+1}
 rank=pd.DataFrame([{"conference":k,"power":v["rating"],"crossConferenceGames":v["games"]} for k,v in cr.items()]).sort_values("power",ascending=False)
 rank.insert(0,"rank",range(1,len(rank)+1)); rank.to_csv(OUT/"conference-rankings.csv",index=False)
 report={"version":"CFB-v5-context-v1","marketInformed":False,"season":latest,"conferenceMethod":"point-in-time cross-conference neutralized margin, shrunk sequential updates","personnelState":"UNKNOWN until timestamped roster/injury source is connected","rows":len(out)}
 (OUT/"report.json").write_text(json.dumps(report,indent=2)); print(rank.to_string(index=False)); print(json.dumps(report,indent=2))
if __name__=="__main__": main()
