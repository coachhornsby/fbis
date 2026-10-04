#!/usr/bin/env python3
"""Robustness gate for replicated CFB subset candidates."""
from pathlib import Path
import json, math
import numpy as np, pandas as pd
from statistics import NormalDist
BASE=Path("artifacts/cfb-final/subset-audit")
PRED=Path("artifacts/cfb-final/model-v5/oos-predictions.csv")
CTX=Path("artifacts/cfb-final/v5-context/cfb_v5_context.csv")
FPR=Path("artifacts/cfb-final/fpr/game-fpr.csv")
OUT=BASE/"robustness"; OUT.mkdir(parents=True,exist_ok=True)
DIMS=["home_conference","away_conference","market_favorite","model_favorite","model_market_side_agree","abs_spread_band","market_total_band","side_edge_band","total_edge_band","fpr_gap_band","week_band","site"]

def n(x):return pd.to_numeric(x,errors="coerce")
def enrich():
 p=pd.read_csv(PRED);c=pd.read_csv(CTX,low_memory=False)
 keep=[q for q in ["game_id","home_conference","away_conference","neutral_site","week"] if q in c]
 x=p.merge(c[keep].drop_duplicates("game_id"),on="game_id",how="left")
 f=pd.read_csv(FPR);x=x.merge(f[["game_id","home_fpr","away_fpr"]],on="game_id",how="left")
 x["market_favorite"]=np.select([n(x.market_margin)>0,n(x.market_margin)<0],["home","away"],default="pick")
 x["model_favorite"]=np.where(n(x.v5_margin)>0,"home","away")
 x["model_market_side_agree"]=np.where(np.sign(n(x.v5_margin))==np.sign(n(x.market_margin)),"agree","disagree")
 x["abs_spread_band"]=pd.cut(n(x.market_margin).abs(),[-.01,3,7,14,1e9],labels=["0-3","3-7","7-14","14+"]).astype(str)
 x["market_total_band"]=pd.cut(n(x.market_total),[-1e9,45,55,65,1e9],labels=["<45","45-55","55-65","65+"]).astype(str)
 x["side_edge_band"]=pd.cut((n(x.v5_margin)-n(x.market_margin)).abs(),[-.01,1,2,3,5,8,1e9],labels=["0-1","1-2","2-3","3-5","5-8","8+"]).astype(str)
 x["total_edge_band"]=pd.cut((n(x.v5_total)-n(x.market_total)).abs(),[-.01,1,2,3,5,8,1e9],labels=["0-1","1-2","2-3","3-5","5-8","8+"]).astype(str)
 x["fpr_gap_band"]=pd.cut((n(x.home_fpr)-n(x.away_fpr)).abs(),[-.01,3,7,14,1e9],labels=["0-3","3-7","7-14","14+"]).astype(str)
 x["week_band"]=pd.cut(n(x.week),[-1,4,8,12,1e9],labels=["W1-4","W5-8","W9-12","W13+"]).astype(str)
 x["site"]=np.where(x.neutral_site.astype(str).str.lower().isin(["1","true","yes"]),"neutral","home")
 return x
def filter_rule(x,r):
 z=x
 for d in DIMS:
  if d in r and pd.notna(r[d]):z=z[z[d].astype(str)==str(r[d])]
 return z
def outcomes(z,m):
 if m=="spread":e=n(z.v5_margin)-n(z.market_margin);r=n(z.actual_margin)-n(z.market_margin)
 else:e=n(z.v5_total)-n(z.market_total);r=n(z.actual_total)-n(z.market_total)
 ok=e.notna()&r.notna()&(e.abs()>1e-12)&(~np.isclose(r,0));return (np.sign(e[ok])==np.sign(r[ok])).astype(int)
def stat(y):
 N=len(y);W=int(y.sum());wr=W/N if N else np.nan;units=W/1.1-(N-W)
 # one-sided normal approximation versus break-even 0.52381
 p0=1.1/2.1
 if N:
  z=(wr-p0)/math.sqrt(p0*(1-p0)/N);p=1-NormalDist().cdf(z)
 else:p=1
 return N,W,wr,units,p
def bh(p):
 p=np.asarray(p,float);m=len(p);o=np.argsort(p);q=np.empty(m);prev=1.
 for rank,idx in reversed(list(enumerate(o,1))):
  prev=min(prev,p[idx]*m/rank);q[idx]=prev
 return q
def main():
 x=enrich();cand=pd.read_csv(BASE/"replicated-candidates.csv");rows=[]
 for _,r in cand.iterrows():
  z=filter_rule(x,r);d=z[z.season<=2024];h=z[z.season>=2025]
  dy=outcomes(d,r.market);hy=outcomes(h,r.market)
  dn,dw,dwr,du,dp=stat(dy);hn,hw,hwr,hu,hp=stat(hy)
  yrs=[]
  for yr,g in z.groupby("season"):
   yy=outcomes(g,r.market)
   if len(yy)>=10:
    _,_,wr,u,_=stat(yy);yrs.append((int(yr),len(yy),wr,u))
  positive=sum(u>0 for _,_,_,u in yrs);tested=len(yrs)
  # leave-one-discovery-season-out: rule remains profitable after removing any one season
  loo=[]
  for yr in sorted(d.season.dropna().unique()):
   yy=outcomes(d[d.season!=yr],r.market)
   if len(yy):loo.append(stat(yy)[3])
  rec={k:r[k] for k in ["dimensions","market"]+DIMS if k in r and pd.notna(r[k])}
  rec.update({"discoveryN":dn,"discoveryWR":dwr,"discoveryUnits":du,"discoveryP":dp,
   "holdoutN":hn,"holdoutWR":hwr,"holdoutUnits":hu,"holdoutP":hp,
   "seasonsTested":tested,"positiveSeasons":positive,"positiveSeasonRate":positive/tested if tested else 0,
   "minLeaveOneSeasonOutUnits":min(loo) if loo else np.nan,"seasonStats":json.dumps(yrs)})
  rows.append(rec)
 q=pd.DataFrame(rows);q["discoveryQ"]=bh(q.discoveryP);q["holdoutQ"]=bh(q.holdoutP)
 q["robustPass"]=(q.discoveryQ<=.10)&(q.holdoutQ<=.10)&(q.positiveSeasonRate>=.60)&(q.minLeaveOneSeasonOutUnits>0)&(q.discoveryWR>.52381)&(q.holdoutWR>.52381)
 # Redundancy pruning: among robust rules with same market, keep strongest holdout rule when one has identical realized game set.
 robust=q[q.robustPass].sort_values(["holdoutQ","holdoutUnits","discoveryUnits"],ascending=[True,False,False]).copy()
 seen=set();keep=[]
 for idx,r in robust.iterrows():
  z=filter_rule(x,r);ids=tuple(sorted(z.game_id.astype(str).tolist()));key=(r.market,ids)
  if key not in seen:seen.add(key);keep.append(idx)
 robust["nonRedundant"]=robust.index.isin(keep)
 q.to_csv(OUT/"all-candidate-robustness.csv",index=False)
 robust[robust.nonRedundant].to_csv(OUT/"robust-signals.csv",index=False)
 report={"version":"CFB-v5-subset-robustness-v1","inputCandidates":len(q),"fdr":"Benjamini-Hochberg q<=0.10 separately applied to discovery and holdout","breakEvenWinRate":1.1/2.1,
 "requirements":["discovery q<=0.10","holdout q<=0.10",">=60% profitable tested seasons","positive discovery after leaving out any one season","win rate above -110 break-even in both samples"],
 "robustBeforeRedundancy":int(q.robustPass.sum()),"robustAfterExactRedundancy":int((robust.nonRedundant).sum())}
 (OUT/"report.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=="__main__":main()
