#!/usr/bin/env python3
"""CFB-FBIS-v6 causal context challengers built only from pregame-safe history."""
from pathlib import Path
import json, numpy as np, pandas as pd
SRC=Path("artifacts/cfb-final/v5-context/cfb_v5_context.csv")
CONF=Path("artifacts/cfb-final/conference-power/game-conference-power.csv")
OUT=Path("artifacts/cfb-final/v6-context");OUT.mkdir(parents=True,exist_ok=True)
def n(x):return pd.to_numeric(x,errors="coerce")
def truth(v):return str(v).strip().lower() in {"1","true","yes","y"}
def pick(d,names):return next((x for x in names if x in d),None)
def main():
 d=pd.read_csv(SRC,low_memory=False);d["season"]=n(d.season).astype(int);d["week"]=n(d.week)
 nc=pick(d,["neutral_site","neutralSite","neutral"]); venue=pick(d,["venue_id","venueId","venue"])
 # Hierarchical conference power already generated from immutable pre-week states.
 if CONF.exists():
  q=pd.read_csv(CONF)[["game_id","conf_home_power","conf_away_power","conf_diff_power","conf_home_cross_games_prior","conf_away_cross_games_prior"]]
  d=d.merge(q,on="game_id",how="left")
 # Cross-season team strength prior + team home advantage, both updated only after games.
 prior_team={}; prior_hfa={}; rows=[]
 for season,sg in d.sort_values(["season","week","game_id"]).groupby("season",sort=True):
  team={k:.65*v for k,v in prior_team.items()}
  hfa={k:{"sum":.5*v.get("mean",0)*v.get("n",0),"n":.5*v.get("n",0)} for k,v in prior_hfa.items()}
  for week,wg in sg.groupby("week",sort=True):
   snap={}
   for _,r in wg.iterrows():
    h=str(r.home_id);a=str(r.away_id);hr=team.get(h,0.0);ar=team.get(a,0.0)
    neutral=truth(r.get(nc,False)) if nc else False
    hs=hfa.get(h,{"sum":0.0,"n":0.0}); shrink=8.0
    team_hfa=0.0 if neutral else 2.5+(hs["sum"]/(hs["n"]+shrink))
    rows.append({"game_id":r.game_id,"v6_home_team_prior":hr,"v6_away_team_prior":ar,"v6_diff_team_prior":hr-ar,
      "v6_hfa":team_hfa,"v6_home_hfa_games_prior":hs["n"]})
    snap[r.game_id]=(h,a,hr,ar,team_hfa,neutral)
   delta={};cnt={}
   for _,r in wg.iterrows():
    if pd.isna(r.home_score) or pd.isna(r.away_score):continue
    h,a,hr,ar,hh,neutral=snap[r.game_id]; margin=float(r.home_score)-float(r.away_score)
    resid=float(np.clip(margin-hh-(hr-ar),-35,35));k=.14
    delta[h]=delta.get(h,0)+k*resid/2;delta[a]=delta.get(a,0)-k*resid/2
    if not neutral:
     hs=hfa.get(h,{"sum":0.0,"n":0.0}); base_resid=float(np.clip(margin-(hr-ar)-2.5,-21,21))
     hfa[h]={"sum":hs["sum"]+base_resid,"n":hs["n"]+1}
   for t in set(team)|set(delta):team[t]=team.get(t,0)+delta.get(t,0)
  prior_team=team
  prior_hfa={k:{"mean":v["sum"]/v["n"] if v["n"] else 0,"n":v["n"]} for k,v in hfa.items()}
 x=pd.DataFrame(rows);out=d.merge(x,on="game_id",how="left")
 # Safe QB continuity only if canonical identity exists. Never derive current-game QB from boxscore.
 hqb=pick(out,["home_primary_qb_pregame","home_expected_qb","home_starting_qb_pregame"])
 aqb=pick(out,["away_primary_qb_pregame","away_expected_qb","away_starting_qb_pregame"])
 out["v6_qb_pregame_source_known"]=int(bool(hqb and aqb))
 if hqb and aqb:
  # prior appearance continuity by team, shifted one game
  last={}
  hc=[];ac=[]
  for _,r in out.sort_values(["season","week","game_id"]).iterrows():
   h=str(r.home_id);a=str(r.away_id);hq=str(r[hqb]) if pd.notna(r[hqb]) else None;aq=str(r[aqb]) if pd.notna(r[aqb]) else None
   hc.append(int(hq is not None and last.get(h)==hq));ac.append(int(aq is not None and last.get(a)==aq))
   if hq:last[h]=hq
   if aq:last[a]=aq
  out["v6_home_qb_continuity"]=hc;out["v6_away_qb_continuity"]=ac;out["v6_diff_qb_continuity"]=out.v6_home_qb_continuity-out.v6_away_qb_continuity
 out.to_csv(OUT/"cfb_v6_context.csv",index=False)
 report={"version":"CFB-v6-context-v1","marketInformed":False,"teamPrior":"prior-season terminal team strength retained 65%, weekly immutable snapshots","conferencePower":"hierarchical pre-week conference power from CFB-CONF-v3","hfa":"team-specific home residual shrunk toward national 2.5 baseline with 8-game prior","qbPregameColumns":[hqb,aqb],"qbContinuityEnabled":bool(hqb and aqb),"injuryAvailability":"UNAVAILABLE unless timestamped pregame source exists; no postgame inference","weather":"v5 broad weather regex intentionally not promoted into v6 until semantically verified"}
 (OUT/"report.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=="__main__":main()
