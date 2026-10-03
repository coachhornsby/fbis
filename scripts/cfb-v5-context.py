#!/usr/bin/env python3
"""CFB v5 point-in-time context: opponent/SOS, conference, HFA, pace, FCS, QB continuity, environment contracts."""
from pathlib import Path
import json, re
import numpy as np, pandas as pd
SRC=Path("artifacts/cfb-final/cfb_training_full_enriched_2004_2026.csv")
OUT=Path("artifacts/cfb-final/v5-context"); OUT.mkdir(parents=True,exist_ok=True)
def n(x): return pd.to_numeric(x,errors="coerce")
def first_col(d,names):
 for x in names:
  if x in d.columns:return x
 return None
def truth(v):
 if pd.isna(v): return False
 if isinstance(v,bool): return v
 return str(v).strip().lower() in {"1","true","yes","y"}
def main():
 d=pd.read_csv(SRC,low_memory=False); d["season"]=n(d.season).astype("Int64"); d["week"]=n(d.week)
 hc=first_col(d,["home_conference","home_conference_name","home_conf","home_conference_abbreviation"])
 ac=first_col(d,["away_conference","away_conference_name","away_conf","away_conference_abbreviation"])
 if not hc or not ac: raise RuntimeError("conference columns missing; available conference-like columns="+str([x for x in d.columns if "conference" in x.lower() or x.lower().endswith("_conf")]))
 neutral_col=first_col(d,["neutral_site","neutralSite","neutral"])
 fcs_h=first_col(d,["home_classification","home_division","home_subdivision"])
 fcs_a=first_col(d,["away_classification","away_division","away_subdivision"])
 pace_cols=[x for x in d.columns if x.startswith(("home_pregame_","away_pregame_")) and re.search(r"pace|plays|drive|possession|seconds_per|tempo",x,re.I)]
 weather_cols=[x for x in d.columns if re.search(r"weather|wind|temperature|temp|precip|humidity",x,re.I) and not re.search(r"market|odds",x,re.I)]
 rows=[]; conf_history=[]; final_conf={}
 for season,sg in d.sort_values(["season","week","game_id"]).groupby("season",sort=True):
  team={}; conf={}
  for week,wg in sg.groupby("week",sort=True):
   snapshots={}
   for _,r in wg.iterrows():
    h=str(r.home_id); a=str(r.away_id); H=team.get(h,{"rating":0.0,"games":0}); A=team.get(a,{"rating":0.0,"games":0})
    ch=str(r.get(hc,"UNKNOWN")); ca=str(r.get(ac,"UNKNOWN")); CH=conf.get(ch,{"rating":0.0,"games":0}); CA=conf.get(ca,{"rating":0.0,"games":0})
    neutral=truth(r.get(neutral_col,False)) if neutral_col else False
    hfa=0.0 if neutral else 2.5
    # opponent-adjusted schedule strength: opponent pregame rating, never postgame/final-season rating
    rec={"game_id":r.game_id,"v5_home_sos":A["rating"],"v5_away_sos":H["rating"],
      "v5_diff_sos":A["rating"]-H["rating"],"v5_sum_sos":A["rating"]+H["rating"],
      "v5_home_conference_strength":CH["rating"],"v5_away_conference_strength":CA["rating"],
      "v5_diff_conference_strength":CH["rating"]-CA["rating"],"v5_sum_conference_strength":CH["rating"]+CA["rating"],
      "v5_hfa":hfa,"v5_home_games_prior":H["games"],"v5_away_games_prior":A["games"],
      "v5_personnel_known":0,"v5_ol_availability_known":0,"v5_def_availability_known":0}
    # QB continuity from canonical pregame identity only; missing is unknown, not healthy.
    hqb=r.get("home_primary_qb"); aqb=r.get("away_primary_qb")
    rec["v5_qb_identity_known"]=int(pd.notna(hqb) and pd.notna(aqb))
    if fcs_h: rec["v5_home_fcs"]=int("fcs" in str(r.get(fcs_h,"")).lower())
    if fcs_a: rec["v5_away_fcs"]=int("fcs" in str(r.get(fcs_a,"")).lower())
    if fcs_h and fcs_a:
      rec["v5_diff_fcs"]=rec["v5_home_fcs"]-rec["v5_away_fcs"]; rec["v5_sum_fcs"]=rec["v5_home_fcs"]+rec["v5_away_fcs"]
    rows.append(rec); snapshots[r.game_id]=(H,A,CH,CA,ch,ca,h,a,hfa)
   for _,r in wg.iterrows():
    if pd.isna(r.home_score) or pd.isna(r.away_score):continue
    H,A,CH,CA,ch,ca,h,a,hfa=snapshots[r.game_id]
    result=float(r.home_score)-float(r.away_score)-hfa; resid=float(np.clip(result-(H["rating"]-A["rating"]),-35,35))
    # team opponent adjustment, modest K to avoid early-season whipsaw
    k=.16; team[h]={"rating":H["rating"]+k*resid/2,"games":H["games"]+1}; team[a]={"rating":A["rating"]-k*resid/2,"games":A["games"]+1}
    if ch!=ca and ch!="UNKNOWN" and ca!="UNKNOWN":
      cres=float(np.clip(result-(CH["rating"]-CA["rating"]),-35,35)); ck=.06
      conf[ch]={"rating":CH["rating"]+ck*cres/2,"games":CH["games"]+1}; conf[ca]={"rating":CA["rating"]-ck*cres/2,"games":CA["games"]+1}
   for name,v in conf.items(): conf_history.append({"season":int(season),"week":float(week),"conference":name,"power":v["rating"],"crossConferenceGames":v["games"]})
  final_conf[int(season)]=conf
 x=pd.DataFrame(rows); out=d.merge(x,on="game_id",how="left")
 # expose existing pace/weather candidates under explicit v5 names without inventing unavailable values
 for col in pace_cols:
  if col.startswith("home_"):
   a="away_"+col[len("home_"):]
   if a in out:
    out["v5_diff_"+col[len("home_pregame_"):]]=n(out[col])-n(out[a]); out["v5_sum_"+col[len("home_pregame_"):]]=n(out[col])+n(out[a])
 out.to_csv(OUT/"cfb_v5_context.csv",index=False)
 hist=pd.DataFrame(conf_history); hist.to_csv(OUT/"conference-history.csv",index=False)
 latest=max(final_conf); cr=final_conf[latest]
 rank=pd.DataFrame([{"conference":k,"power":v["rating"],"crossConferenceGames":v["games"]} for k,v in cr.items()])
 if len(rank): rank=rank.sort_values(["power","crossConferenceGames"],ascending=[False,False]).reset_index(drop=True);rank.insert(0,"rank",range(1,len(rank)+1))
 rank.to_csv(OUT/"conference-rankings.csv",index=False)
 report={"version":"CFB-v5-context-v2","marketInformed":False,"season":latest,"conferenceColumns":[hc,ac],"neutralColumn":neutral_col,
  "paceSourceColumns":pace_cols,"weatherSourceColumns":weather_cols,
  "conferenceMethod":"point-in-time cross-conference HFA-neutralized margin with sequential shrinkage; updates after weekly snapshot",
  "opponentMethod":"point-in-time opponent rating with prior-game-only sequential updates",
  "hfaMethod":"explicit 2.5 national baseline; neutral site 0; hierarchical venue HFA remains challenger until venue sample supports it",
  "personnelState":"UNKNOWN until timestamped roster/injury source is connected","rows":len(out)}
 (OUT/"report.json").write_text(json.dumps(report,indent=2));print(rank.to_string(index=False));print(json.dumps(report,indent=2))
if __name__=="__main__":main()
