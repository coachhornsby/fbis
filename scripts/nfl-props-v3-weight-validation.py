#!/usr/bin/env python3
"""
NFL-PROPS-v3 leakage-safe weight validation.

Grid:
  recent-five weight: 65,70,75,80,85,90%
  opponent position-defense strength: 0,.25,.45,.60,.75

Validation is conditional on the player appearing in the game, matching the
production availability gate. No sportsbook line is used.
"""
from __future__ import annotations
import io, json, math
from pathlib import Path
from urllib.request import Request, urlopen
import numpy as np
import pandas as pd

SEASONS=list(range(2022,2027))
WEIGHTS=[.65,.70,.75,.80,.85,.90]
DEF_STRENGTHS=[0,.25,.45,.60,.75]
RW=np.array([.35,.25,.18,.13,.09])
OUT=Path("artifacts/nfl-props-v3-validation"); OUT.mkdir(parents=True,exist_ok=True)
URL="https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"
ALIASES={"JAC":"JAX","LA":"LAR","STL":"LAR","SD":"LAC","OAK":"LV","WSH":"WAS"}
FIELDS=["completions","attempts","passing_yards","carries","rushing_yards","targets","receptions","receiving_yards"]
MARKETS={
 "passing_yards":("QB","passing_yards"),
 "passing_attempts":("QB","attempts"),
 "completions":("QB","completions"),
 "rushing_yards":("RB","rushing_yards"),
 "rushing_attempts":("RB","carries"),
 "receiving_yards":("REC","receiving_yards"),
 "receptions":("REC","receptions"),
}

def canon(x):
 s=str(x or "").strip().upper(); return ALIASES.get(s,s)

def read_csv(url):
 req=Request(url,headers={"User-Agent":"FBIS-nfl-props-validation/2.0"})
 with urlopen(req,timeout=120) as r:return pd.read_csv(io.BytesIO(r.read()),low_memory=False)

def load():
 frames=[];status=[]
 for season in SEASONS:
  try:
   d=read_csv(URL.format(season=season))
   if "season" not in d:d["season"]=season
   d["season"]=pd.to_numeric(d["season"],errors="coerce").fillna(season).astype(int)
   d["week"]=pd.to_numeric(d["week"],errors="coerce")
   st=d["season_type"] if "season_type" in d else pd.Series("REG",index=d.index)
   d=d[st.astype(str).str.upper().eq("REG")].copy()
   d["team"]=d["team"].map(canon); d["opponent_team"]=d["opponent_team"].map(canon)
   idcol="player_id" if "player_id" in d else ("player_id_name" if "player_id_name" in d else "player_name")
   namecol="player_display_name" if "player_display_name" in d else ("player_name" if "player_name" in d else idcol)
   poscol="position" if "position" in d else "position_group"
   d["pid"]=d[idcol].astype(str); d["pname"]=d[namecol].astype(str); d["pos"]=d[poscol].astype(str).str.upper()
   for x in FIELDS:d[x]=pd.to_numeric(d[x],errors="coerce").fillna(0) if x in d else 0.0
   d=d[d.pos.isin(["QB","RB","WR","TE"]) & d.week.notna()].copy()
   frames.append(d[["season","week","team","opponent_team","pid","pname","pos"]+FIELDS])
   status.append({"season":season,"rows":int(len(d)),"status":"ok"})
  except Exception as e:status.append({"season":season,"rows":0,"status":"failed","error":str(e)})
 if not frames:raise RuntimeError("No player-week data")
 return pd.concat(frames,ignore_index=True).sort_values(["pid","season","week"]).reset_index(drop=True),status

def add_player_pregame(d):
 x=d.copy()
 g=x.groupby("pid",sort=False)
 for f in FIELDS:
  lags=[g[f].shift(i) for i in range(1,6)]
  den=sum((lag.notna().astype(float)*RW[i]) for i,lag in enumerate(lags))
  nume=sum((lag.fillna(0)*RW[i]) for i,lag in enumerate(lags))
  x[f"recent_{f}"]=nume/den.replace(0,np.nan)
  x[f"current_{f}"]=x.groupby(["pid","season"],sort=False)[f].transform(lambda s:s.shift(1).expanding().mean())
 # prior-season player means
 means=x.groupby(["pid","season"],as_index=False)[FIELDS].mean()
 means["season"]=means["season"]+1
 means=means.rename(columns={f:f"prior_{f}" for f in FIELDS})
 x=x.merge(means,on=["pid","season"],how="left")
 # prior-only usage score; current row's stats never enter.
 x["role_score"]=np.select(
  [x.pos.eq("QB"),x.pos.eq("RB"),x.pos.isin(["WR","TE"])],
  [x["recent_attempts"]*2+x["recent_carries"]*.2,
   x["recent_carries"]+x["recent_targets"]*.8,
   x["recent_targets"]*2+x["recent_receptions"]],
  default=np.nan
 )
 # Conditional on confirmed availability (player appears in game), rank only by prior usage.
 x["rank"]=x.groupby(["season","week","team","pos"])["role_score"].rank(method="first",ascending=False)
 x["role"]=None
 x.loc[x.pos.eq("QB") & x["rank"].eq(1),"role"]="QB1"
 x.loc[x.pos.eq("RB") & x["rank"].eq(1),"role"]="RB1"
 x.loc[x.pos.eq("WR") & x["rank"].eq(1),"role"]="WR1"
 x.loc[x.pos.eq("WR") & x["rank"].eq(2),"role"]="WR2"
 x.loc[x.pos.eq("TE") & x["rank"].eq(1),"role"]="TE1"
 return x

def add_defense_pregame(x):
 # actual full position-group production allowed in each defense game
 agg=x.groupby(["season","week","opponent_team","pos"],as_index=False)[FIELDS].sum().rename(columns={"opponent_team":"defense"})
 agg=agg.sort_values(["defense","pos","season","week"]).reset_index(drop=True)
 for f in FIELDS:
  agg[f"def_cur_{f}"]=agg.groupby(["defense","pos","season"],sort=False)[f].transform(lambda s:s.shift(1).expanding().mean())
 # prior season averages by defense/position
 prior=agg.groupby(["defense","pos","season"],as_index=False)[FIELDS].mean()
 prior["season"]=prior["season"]+1
 prior=prior.rename(columns={f:f"def_prior_{f}" for f in FIELDS})
 agg=agg.merge(prior,on=["defense","pos","season"],how="left")
 # games played before current week for shrinkage
 agg["def_n"]=agg.groupby(["defense","pos","season"]).cumcount()
 for f in FIELDS:
  w=agg["def_n"]/(agg["def_n"]+8)
  cur=agg[f"def_cur_{f}"]; prv=agg[f"def_prior_{f}"]
  agg[f"def_allowed_{f}"]=np.where(cur.notna()&prv.notna(),prv*(1-w)+cur*w,cur.fillna(prv))
 # league expectation from pregame defense estimates for the same season/week/position
 for f in FIELDS:
  agg[f"league_{f}"]=agg.groupby(["season","week","pos"])[f"def_allowed_{f}"].transform("mean")
 keep=["season","week","defense","pos"]+[f"def_allowed_{f}" for f in FIELDS]+[f"league_{f}" for f in FIELDS]
 return x.merge(agg[keep],left_on=["season","week","opponent_team","pos"],right_on=["season","week","defense","pos"],how="left")

def blend(r,field,w):
 rem=1-w; wc=rem*25/35; wp=rem*10/35
 vals=[(getattr(r,f"recent_{field}"),w),(getattr(r,f"current_{field}"),wc),(getattr(r,f"prior_{field}"),wp)]
 vals=[(float(v),wt) for v,wt in vals if pd.notna(v)]
 if not vals:return np.nan
 den=sum(wt for _,wt in vals); return sum(v*wt for v,wt in vals)/den

def examples(x):
 rows=[]
 z=x[x.role.notna()].copy()
 for r in z.itertuples(index=False):
  for market,(kind,field) in MARKETS.items():
   if kind=="QB" and r.pos!="QB":continue
   if kind=="RB" and r.pos!="RB":continue
   if kind=="REC" and r.pos not in ("WR","TE"):continue
   recent=getattr(r,f"recent_{field}")
   if pd.isna(recent):continue
   rows.append({
    "season":int(r.season),"week":int(r.week),"team":r.team,"opponent":r.opponent_team,
    "pid":r.pid,"player":r.pname,"position":r.pos,"role":r.role,"market":market,"field":field,
    "actual":float(getattr(r,field)),
    **{f"recent_{field}":recent,f"current_{field}":getattr(r,f"current_{field}"),f"prior_{field}":getattr(r,f"prior_{field}")},
    "opp_allowed":getattr(r,f"def_allowed_{field}"),"league_allowed":getattr(r,f"league_{field}"),
   })
 return pd.DataFrame(rows)

def score(ex):
 results=[];predrows=[]
 for wr in WEIGHTS:
  for ds in DEF_STRENGTHS:
   vals=[]
   for r in ex.itertuples(index=False):
    base=blend(r,r.field,wr)
    if pd.isna(base):continue
    factor=1.
    if pd.notna(r.opp_allowed) and pd.notna(r.league_allowed) and r.league_allowed>0:
     factor=max(.82,min(1.18,1+(r.opp_allowed/r.league_allowed-1)*ds))
    pred=max(0.,base*factor)
    vals.append((r.market,r.actual,pred))
    predrows.append({"recent_weight":wr,"def_strength":ds,"season":r.season,"week":r.week,"player":r.player,"role":r.role,"market":r.market,"actual":r.actual,"prediction":pred})
   td=pd.DataFrame(vals,columns=["market","actual","prediction"])
   mets={}
   for m,g in td.groupby("market"):
    e=g.prediction-g.actual;mae=float(e.abs().mean());mean=float(g.actual.mean())
    mets[m]={"n":int(len(g)),"mae":mae,"rmse":float(np.sqrt(np.mean(e**2))),"relativeMae":mae/max(mean,1.),"bias":float(e.mean())}
   if not mets:continue
   results.append({"recent_weight":wr,"current_weight":(1-wr)*25/35,"prior_weight":(1-wr)*10/35,"def_strength":ds,"n":int(len(td)),
    "objective_mean_relative_mae":float(np.mean([v["relativeMae"] for v in mets.values()])),"markets":mets})
 results.sort(key=lambda r:r["objective_mean_relative_mae"])
 return results,pd.DataFrame(predrows)

def main():
 d,status=load()
 x=add_defense_pregame(add_player_pregame(d))
 ex=examples(x)
 if len(ex)<500:raise RuntimeError(f"insufficient examples={len(ex)}")
 results,preds=score(ex)
 seasonal={}
 for s,g in ex.groupby("season"):
  if len(g)>=50:seasonal[str(int(s))]=score(g)[0][:5]
 report={
  "model":"NFL-PLAYER-PROJ-v3-weight-validation-v2",
  "createdUtc":pd.Timestamp.utcnow().isoformat(),
  "sourceStatus":status,"examples":int(len(ex)),
  "roles":["QB1","RB1","WR1","WR2","TE1"],
  "recentWeightGrid":WEIGHTS,"defenseStrengthGrid":DEF_STRENGTHS,
  "recentGameWeights":RW.tolist(),
  "objective":"Equal-weight mean across seven markets of MAE / max(mean actual,1). Lower is better.",
  "best":results[0],"top10":results[:10],"seasonalTop5":seasonal,
  "temporalIntegrity":"Player recent/current/prior and defense allowance features are shifted before current-game outcomes. Role rank uses prior usage only.",
  "availabilityNote":"Conditional on player appearance, matching production's separate availability gate.",
  "marketNote":"No sportsbook or PrizePicks lines are model inputs or validation labels; profitability still requires historical market-line settlement.",
 }
 (OUT/"report.json").write_text(json.dumps(report,indent=2)); ex.to_csv(OUT/"examples.csv",index=False); preds.to_csv(OUT/"predictions-grid.csv",index=False)
 print(json.dumps(report,indent=2))

if __name__=="__main__":main()
