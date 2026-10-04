#!/usr/bin/env python3
"""Systematic CFB OOS subgroup audit for model and market residuals.

Descriptive audit only: reports every predeclared slice with N, model MAE/winner accuracy,
ATS/O-U W-L-P and -110 units. No subgroup is promoted without discovery/holdout replication.
"""
from pathlib import Path
import json,math
import numpy as np,pandas as pd
PRED=Path("artifacts/cfb-final/model-v5/oos-predictions.csv")
CTX=Path("artifacts/cfb-final/v5-context/cfb_v5_context.csv")
FPR=Path("artifacts/cfb-final/fpr/game-fpr.csv")
OUT=Path("artifacts/cfb-final/subset-audit");OUT.mkdir(parents=True,exist_ok=True)

def n(x):return pd.to_numeric(x,errors="coerce")
def ci(k,N):
 if N<=0:return [None,None]
 z=1.96;p=k/N;den=1+z*z/N;c=(p+z*z/(2*N))/den;h=z*math.sqrt((p*(1-p)+z*z/(4*N))/N)/den
 return [max(0,c-h),min(1,c+h)]
def grade(z,edge,result):
 q=z.copy();e=n(q[edge]);r=n(q[result]);ok=e.notna()&r.notna()&(e.abs()>1e-12);q=q[ok].copy();e=e[ok];r=r[ok]
 q["grade"]=np.where(np.isclose(r,0),"P",np.where(np.sign(e)==np.sign(r),"W","L"));return q
def summarize(z):
 if len(z)==0:return None
 am=n(z.actual_margin);pm=n(z.v5_margin);at=n(z.actual_total);pt=n(z.v5_total)
 good=am.notna()&pm.notna();w=int(((am[good]>0)==(pm[good]>0)).sum());N=int(good.sum())
 spread=grade(z.assign(spread_edge=n(z.v5_margin)-n(z.market_margin),spread_result=n(z.actual_margin)-n(z.market_margin)),"spread_edge","spread_result")
 total=grade(z.assign(total_edge=n(z.v5_total)-n(z.market_total),total_result=n(z.actual_total)-n(z.market_total)),"total_edge","total_result")
 def bet(q):
  W=int((q.grade=="W").sum());L=int((q.grade=="L").sum());P=int((q.grade=="P").sum());dec=W+L
  return {"bets":len(q),"wins":W,"losses":L,"pushes":P,"winRate":W/dec if dec else None,"winRate95":ci(W,dec),"unitsAtMinus110":W*(100/110)-L}
 return {"n":len(z),"marginMae":float(np.mean(np.abs(am-pm))),"totalMae":float(np.mean(np.abs(at-pt))),"winnerAccuracy":w/N if N else None,"winner95":ci(w,N),"spread":bet(spread),"total":bet(total)}
def main():
 p=pd.read_csv(PRED);c=pd.read_csv(CTX,low_memory=False)
 keep=[x for x in ["game_id","home_conference","away_conference","neutral_site","week"] if x in c]
 x=p.merge(c[keep].drop_duplicates("game_id"),on="game_id",how="left")
 f=pd.read_csv(FPR);x=x.merge(f[["game_id","home_fpr","away_fpr"]],on="game_id",how="left")
 x["market_favorite"]=np.where(n(x.market_margin)>0,"home",np.where(n(x.market_margin)<0,"away","pick"))
 x["abs_spread"]=n(x.market_margin).abs();x["spread_band"]=pd.cut(x.abs_spread,[-.01,3,7,14,1e9],labels=["0-3","3-7","7-14","14+"])
 x["total_band"]=pd.cut(n(x.market_total),[-1e9,45,55,65,1e9],labels=["<45","45-55","55-65","65+"])
 x["fpr_gap_band"]=pd.cut((n(x.home_fpr)-n(x.away_fpr)).abs(),[-.01,3,7,14,1e9],labels=["0-3","3-7","7-14","14+"])
 specs={"season":["season"],"homeConference":["home_conference"],"awayConference":["away_conference"],
 "seasonHomeConference":["season","home_conference"],"seasonAwayConference":["season","away_conference"],
 "homeConferenceFavorite":["home_conference","market_favorite"],"awayConferenceFavorite":["away_conference","market_favorite"],
 "spreadBand":["spread_band"],"totalBand":["total_band"],"fprGapBand":["fpr_gap_band"]}
 rows=[]
 for name,cols in specs.items():
  for keys,z in x.groupby(cols,dropna=False,observed=True):
   keys=(keys,) if not isinstance(keys,tuple) else keys
   rec={"slice":name,**{cols[i]:str(keys[i]) for i in range(len(cols))},**(summarize(z) or {})};rows.append(rec)
 # Explicit SEC-home-current-season view requested by user.
 latest=int(x.season.max())
 for conf in sorted(x.home_conference.dropna().astype(str).unique()):
  z=x[(x.season==latest)&(x.home_conference.astype(str)==conf)]
  rec={"slice":"currentSeasonHomeConference","season":latest,"home_conference":conf,**(summarize(z) or {})};rows.append(rec)
 pd.DataFrame(rows).to_json(OUT/"subsets.jsonl",orient="records",lines=True)
 sec=[r for r in rows if r.get("slice")=="currentSeasonHomeConference" and r.get("home_conference")=="SEC"]
 report={"version":"CFB-v5-subset-audit-v1","marketInformedModel":False,"purpose":"descriptive subgroup audit; market used only for post-prediction ATS/O-U grading","multipleTestingWarning":"Do not promote a subgroup from this audit alone. Require discovery <=2024 and untouched 2025-26 replication plus adequate N.","secHomeCurrentSeason":sec[0] if sec else None,"rows":len(rows)}
 (OUT/"report.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=="__main__":main()
