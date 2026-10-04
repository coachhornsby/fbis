#!/usr/bin/env python3
"""Hard paired market-superiority gate for CFB-FBIS-v6."""
from pathlib import Path
import json, numpy as np, pandas as pd
SRC=Path("artifacts/cfb-final/model-v6/oos-predictions.csv")
OUT=Path("artifacts/cfb-final/model-v6/market-gate.json")
def met(z,prefix):
 am=z.actual_margin.to_numpy();at=z.actual_total.to_numpy();pm=z[prefix+"_margin"].to_numpy();pt=z[prefix+"_total"].to_numpy()
 return {"n":len(z),"marginMae":float(np.mean(np.abs(am-pm))),"totalMae":float(np.mean(np.abs(at-pt))),
 "winnerAccuracy":float(np.mean((am>0)==(pm>0)))}
def boot(z,B=2000,seed=56):
 rng=np.random.default_rng(seed);N=len(z);vals=[]
 am=z.actual_margin.to_numpy();at=z.actual_total.to_numpy();vm=z.v6_margin.to_numpy();vt=z.v6_total.to_numpy();mm=z.market_margin.to_numpy();mt=z.market_total.to_numpy()
 for _ in range(B):
  i=rng.integers(0,N,N)
  vals.append([np.mean(np.abs(am[i]-mm[i]))-np.mean(np.abs(am[i]-vm[i])),
               np.mean(np.abs(at[i]-mt[i]))-np.mean(np.abs(at[i]-vt[i])),
               np.mean((am[i]>0)==(vm[i]>0))-np.mean((am[i]>0)==(mm[i]>0))])
 a=np.array(vals);return {"marginMaeAdvantage95":np.quantile(a[:,0],[.025,.975]).tolist(),"totalMaeAdvantage95":np.quantile(a[:,1],[.025,.975]).tolist(),"winnerAccuracyAdvantage95":np.quantile(a[:,2],[.025,.975]).tolist()}
def grade(z,kind,t):
 model="v6_margin" if kind=="spread" else "v6_total";market="market_margin" if kind=="spread" else "market_total";actual="actual_margin" if kind=="spread" else "actual_total"
 q=z.copy();q["edge"]=(q[model]-q[market]);q=q[q.edge.abs()>=t];r=q[actual]-q[market];push=np.isclose(r,0);win=(np.sign(q.edge)==np.sign(r))&~push;loss=~win&~push;W=int(win.sum());L=int(loss.sum())
 return {"minEdge":t,"bets":len(q),"wins":W,"losses":L,"winRate":W/(W+L) if W+L else None,"units":W/1.1-L}
def main():
 x=pd.read_csv(SRC).dropna(subset=["market_margin","market_total","v6_margin","v6_total","actual_margin","actual_total"])
 h=x[x.season>=2025]
 def pack(z):
  v=met(z,"v6");m=met(z,"market");b=boot(z)
  return {"v6":v,"market":m,"bootstrap":b,"beatsMarketPointEstimateAllThree":v["marginMae"]<m["marginMae"] and v["totalMae"]<m["totalMae"] and v["winnerAccuracy"]>m["winnerAccuracy"],
   "statisticallyClearAllThree":all(b[k][0]>0 for k in b),
   "spread":[grade(z,"spread",t) for t in [0,1,2,3,4,5,6,8,10]],"total":[grade(z,"total",t) for t in [0,1,2,3,4,5,6,8,10]]}
 report={"version":"CFB-v6-market-gate-v1","marketInformedModel":False,"allPaired":pack(x),"holdout2025_2026":pack(h),
 "qualificationRule":"Must beat market point estimate on margin MAE, total MAE, and winner accuracy overall and holdout; statistical-clear flag requires paired bootstrap 95% advantage above zero for all three. Wager authorization remains separate."}
 report["passesHardForecastGate"]=bool(report["allPaired"]["beatsMarketPointEstimateAllThree"] and report["holdout2025_2026"]["beatsMarketPointEstimateAllThree"])
 (OUT).write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=="__main__":main()
