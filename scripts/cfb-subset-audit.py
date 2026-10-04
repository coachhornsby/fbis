#!/usr/bin/env python3
"""Exhaustive, predeclared CFB OOS subset audit with discovery/holdout replication."""
from pathlib import Path
from itertools import combinations
import json,math
import numpy as np,pandas as pd
PRED=Path("artifacts/cfb-final/model-v5/oos-predictions.csv")
CTX=Path("artifacts/cfb-final/v5-context/cfb_v5_context.csv")
FPR=Path("artifacts/cfb-final/fpr/game-fpr.csv")
OUT=Path("artifacts/cfb-final/subset-audit");OUT.mkdir(parents=True,exist_ok=True)
MIN_DISC=40; MIN_HOLD=20

def n(x): return pd.to_numeric(x,errors="coerce")
def ci(k,N):
 if not N:return [None,None]
 z=1.96;p=k/N;den=1+z*z/N;c=(p+z*z/(2*N))/den;h=z*math.sqrt((p*(1-p)+z*z/(4*N))/N)/den
 return [max(0,c-h),min(1,c+h)]
def bet(z,kind):
 if kind=="spread": edge=n(z.v5_margin)-n(z.market_margin);result=n(z.actual_margin)-n(z.market_margin)
 else: edge=n(z.v5_total)-n(z.market_total);result=n(z.actual_total)-n(z.market_total)
 ok=edge.notna()&result.notna()&(edge.abs()>1e-12);edge=edge[ok];result=result[ok]
 W=int(((np.sign(edge)==np.sign(result))&(~np.isclose(result,0))).sum());P=int(np.isclose(result,0).sum());L=int(len(edge)-W-P);D=W+L
 return {"bets":int(len(edge)),"wins":W,"losses":L,"pushes":P,"winRate":W/D if D else None,"winRate95":ci(W,D),"unitsAtMinus110":W/1.1-L}
def summary(z):
 if z.empty:return None
 am=n(z.actual_margin);pm=n(z.v5_margin);at=n(z.actual_total);pt=n(z.v5_total)
 g=am.notna()&pm.notna();W=int(((am[g]>0)==(pm[g]>0)).sum());N=int(g.sum())
 return {"n":int(len(z)),"marginMae":float((am-pm).abs().mean()),"totalMae":float((at-pt).abs().mean()),
 "winnerAccuracy":W/N if N else None,"winner95":ci(W,N),"spread":bet(z,"spread"),"total":bet(z,"total")}

def main():
 p=pd.read_csv(PRED);c=pd.read_csv(CTX,low_memory=False)
 keep=[q for q in ["game_id","home_conference","away_conference","neutral_site","week"] if q in c]
 x=p.merge(c[keep].drop_duplicates("game_id"),on="game_id",how="left")
 f=pd.read_csv(FPR);x=x.merge(f[["game_id","home_fpr","away_fpr"]],on="game_id",how="left")
 x["market_favorite"]=np.select([n(x.market_margin)>0,n(x.market_margin)<0],["home","away"],default="pick")
 x["model_favorite"]=np.where(n(x.v5_margin)>0,"home","away")
 x["model_market_side_agree"]=np.where(np.sign(n(x.v5_margin))==np.sign(n(x.market_margin)),"agree","disagree")
 x["abs_spread_band"]=pd.cut(n(x.market_margin).abs(),[-.01,3,7,14,1e9],labels=["0-3","3-7","7-14","14+"])
 x["market_total_band"]=pd.cut(n(x.market_total),[-1e9,45,55,65,1e9],labels=["<45","45-55","55-65","65+"])
 x["side_edge_band"]=pd.cut((n(x.v5_margin)-n(x.market_margin)).abs(),[-.01,1,2,3,5,8,1e9],labels=["0-1","1-2","2-3","3-5","5-8","8+"])
 x["total_edge_band"]=pd.cut((n(x.v5_total)-n(x.market_total)).abs(),[-.01,1,2,3,5,8,1e9],labels=["0-1","1-2","2-3","3-5","5-8","8+"])
 x["fpr_gap_band"]=pd.cut((n(x.home_fpr)-n(x.away_fpr)).abs(),[-.01,3,7,14,1e9],labels=["0-3","3-7","7-14","14+"])
 x["week_band"]=pd.cut(n(x.week),[-1,4,8,12,1e9],labels=["W1-4","W5-8","W9-12","W13+"])
 if "neutral_site" in x:x["site"]=np.where(x.neutral_site.astype(str).str.lower().isin(["1","true","yes"]),"neutral","home")
 dims=["home_conference","away_conference","market_favorite","model_favorite","model_market_side_agree",
       "abs_spread_band","market_total_band","side_edge_band","total_edge_band","fpr_gap_band","week_band","site"]
 dims=[d for d in dims if d in x]
 rows=[]
 # All 1-way, 2-way, and 3-way combinations: broad enough to discover interactions without arbitrary row mining.
 for k in (1,2,3):
  for cols in combinations(dims,k):
   for keys,z in x.groupby(list(cols),dropna=False,observed=True):
    keys=keys if isinstance(keys,tuple) else (keys,)
    rec={"dimensions":"|".join(cols),**{cols[i]:str(keys[i]) for i in range(k)}}
    disc=z[z.season<=2024];hold=z[z.season>=2025]
    rec["discovery"]=summary(disc);rec["holdout"]=summary(hold);rec["all"]=summary(z)
    rec["replicationEligible"]=bool(len(disc)>=MIN_DISC and len(hold)>=MIN_HOLD)
    rows.append(rec)
 # Current-season conference views, symmetrical for every conference.
 latest=int(x.season.max())
 for role in ("home_conference","away_conference"):
  for conf,z in x[x.season==latest].groupby(role,dropna=False):
   rows.append({"dimensions":"currentSeason|"+role,"season":latest,role:str(conf),"current":summary(z),"replicationEligible":False})
 pd.DataFrame(rows).to_json(OUT/"subsets.jsonl",orient="records",lines=True)
 # Candidate table: require adequate discovery + holdout N and same profitable direction in both samples.
 cand=[]
 for r in rows:
  if not r.get("replicationEligible"):continue
  for market in ("spread","total"):
   d=r["discovery"][market];h=r["holdout"][market]
   if d["unitsAtMinus110"]>0 and h["unitsAtMinus110"]>0:
    cand.append({"dimensions":r["dimensions"],"market":market,
      "discoveryN":d["bets"],"discoveryWinRate":d["winRate"],"discoveryUnits":d["unitsAtMinus110"],
      "holdoutN":h["bets"],"holdoutWinRate":h["winRate"],"holdoutUnits":h["unitsAtMinus110"],
      **{q:r[q] for q in dims if q in r}})
 pd.DataFrame(cand).sort_values(["holdoutUnits","discoveryUnits"],ascending=False).to_csv(OUT/"replicated-candidates.csv",index=False)
 report={"version":"CFB-v5-subset-audit-v2","dimensions":dims,"interactionDepth":3,"rows":len(rows),
 "replicationRule":{"discovery":"<=2024","holdout":"2025-26","minDiscoveryN":MIN_DISC,"minHoldoutN":MIN_HOLD,"positiveUnitsRequiredBoth":True},
 "candidateCount":len(cand),"marketInformedModel":False,
 "warning":"Exploratory multiple testing remains material. Replicated candidates are research leads, not wager authorization."}
 (OUT/"report.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=="__main__":main()
