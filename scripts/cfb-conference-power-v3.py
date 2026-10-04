#!/usr/bin/env python3
"""Leakage-safe hierarchical conference power.

Carries prior-season terminal conference strength into each new season with regression
toward zero, publishes one immutable pre-week snapshot, and updates only from completed
cross-conference games after the entire week's snapshot has been emitted.
"""
from pathlib import Path
import json
import numpy as np, pandas as pd
SRC=Path("artifacts/cfb-final/v5-context/cfb_v5_context.csv")
OUT=Path("artifacts/cfb-final/conference-power");OUT.mkdir(parents=True,exist_ok=True)

def n(x): return pd.to_numeric(x,errors="coerce")
def truth(v):
 if pd.isna(v): return False
 return str(v).strip().lower() in {"1","true","yes","y"}
def col(d,names):
 return next((x for x in names if x in d),None)

def main():
 d=pd.read_csv(SRC,low_memory=False);d["season"]=n(d.season).astype(int);d["week"]=n(d.week)
 hc=col(d,["home_conference","home_conference_name","home_conf","home_conference_abbreviation"])
 ac=col(d,["away_conference","away_conference_name","away_conf","away_conference_abbreviation"])
 nc=col(d,["neutral_site","neutralSite","neutral"])
 if not hc or not ac: raise RuntimeError("conference columns missing")
 prior={}; hist=[]; game_rows=[]
 for season,sg in d.sort_values(["season","week","game_id"]).groupby("season",sort=True):
  # Prior season is useful information, but aggressively regress it toward average.
  state={k:{"rating":.60*v["rating"],"games":0,"prior":v["rating"]} for k,v in prior.items()}
  for week,wg in sg.groupby("week",sort=True):
   snap={}
   for _,r in wg.iterrows():
    ch=str(r.get(hc,"UNKNOWN"));ca=str(r.get(ac,"UNKNOWN"))
    H=state.get(ch,{"rating":0.0,"games":0,"prior":0.0});A=state.get(ca,{"rating":0.0,"games":0,"prior":0.0})
    snap[r.game_id]=(ch,ca,H["rating"],A["rating"])
    game_rows.append({"game_id":r.game_id,"season":season,"week":week,"home_conference":ch,"away_conference":ca,
      "conf_home_power":H["rating"],"conf_away_power":A["rating"],"conf_diff_power":H["rating"]-A["rating"],
      "conf_home_cross_games_prior":H["games"],"conf_away_cross_games_prior":A["games"]})
   deltas={};counts={}
   for _,r in wg.iterrows():
    if pd.isna(r.home_score) or pd.isna(r.away_score): continue
    ch,ca,hp,ap=snap[r.game_id]
    if ch==ca or "UNKNOWN" in (ch,ca): continue
    hfa=0.0 if (nc and truth(r.get(nc))) else 2.5
    result=float(r.home_score)-float(r.away_score)-hfa
    resid=float(np.clip(result-(hp-ap),-35,35))
    # Conservative conference update. Split residual symmetrically.
    k=.055
    deltas[ch]=deltas.get(ch,0.0)+k*resid/2; deltas[ca]=deltas.get(ca,0.0)-k*resid/2
    counts[ch]=counts.get(ch,0)+1;counts[ca]=counts.get(ca,0)+1
   for conf in set(state)|set(deltas):
    s=state.get(conf,{"rating":0.0,"games":0,"prior":0.0})
    state[conf]={"rating":s["rating"]+deltas.get(conf,0.0),"games":s["games"]+counts.get(conf,0),"prior":s["prior"]}
   for conf,s in state.items():
    hist.append({"season":season,"week":week,"conference":conf,"power":s["rating"],"crossConferenceGames":s["games"],"priorSeasonTerminal":s["prior"]})
  prior={k:dict(v) for k,v in state.items()}
 pd.DataFrame(game_rows).to_csv(OUT/"game-conference-power.csv",index=False)
 h=pd.DataFrame(hist);h.to_csv(OUT/"conference-history.csv",index=False)
 latest=h[(h.season==h.season.max()) & (h.week==h[h.season==h.season.max()].week.max()) & (h.crossConferenceGames>0)].copy()
 latest=latest.sort_values("power",ascending=False).reset_index(drop=True);latest.insert(0,"rank",range(1,len(latest)+1))
 latest.to_csv(OUT/"conference-rankings.csv",index=False)
 report={"version":"CFB-CONF-v3-research","method":"prior-season terminal conference strength regressed 40% toward zero, then pre-week snapshot and post-week cross-conference HFA-neutralized residual updates","marketInformed":False,"sameWeekLeakage":False,"season":int(latest.season.max()),"week":float(latest.week.max())}
 (OUT/"report.json").write_text(json.dumps(report,indent=2));print(latest.to_string(index=False));print(json.dumps(report))
if __name__=="__main__":main()
