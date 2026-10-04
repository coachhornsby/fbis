#!/usr/bin/env python3
from pathlib import Path
import json, numpy as np, pandas as pd
SRC=Path("artifacts/cfb-final/wager-v82/walkforward-wager-scores.csv")
OUT=Path("artifacts/cfb-final/wager-v82-audit");OUT.mkdir(parents=True,exist_ok=True)
LO=110/210+.01;HI=110/210+.03
def g(q):
 W=int(((q.win==1)&(~q.push)).sum());L=int(((q.win==0)&(~q.push)).sum());P=int(q.push.sum());u=W/1.1-L;r=W+L
 return {"bets":len(q),"wins":W,"losses":L,"pushes":P,"winRate":W/r if r else None,"units":u,"roi":u/r if r else None}
def boot(q,B=20000):
 q=q[~q.push];w=q.win.to_numpy();rng=np.random.default_rng(82);a=[]
 if len(w)<2:return None
 for _ in range(B):
  z=w[rng.integers(0,len(w),len(w))];W=z.sum();u=W/1.1-(len(z)-W);a.append(u/len(z))
 return np.quantile(a,[.025,.975]).tolist()
x=pd.read_csv(SRC);x=x[x.kind=="spread"]
q=x[(x.p_win>=LO)&(x.p_win<HI)&(x.edge.abs()>=2)&(x.edge.abs()<12)].copy()
years=[{"season":int(y),**g(z)} for y,z in q.groupby("season")]
positive=sum(r["units"]>0 for r in years);negative=sum(r["units"]<0 for r in years)
rep={"version":"CFB-WAGER-v8.2-cross-era","fixedRule":{"pMin":LO,"pMax":HI,"edgeMin":2,"edgeMax":12},
"overall":g(q),"roi95":boot(q),"seasons":years,"positiveSeasons":positive,"negativeSeasons":negative,
"pre2025":{**g(q[q.season<2025]),"roi95":boot(q[q.season<2025])},
"2025_2026":{**g(q[q.season>=2025]),"roi95":boot(q[q.season>=2025])}}
rep["crossEraPass"]=bool(rep["pre2025"]["bets"]>=150 and rep["pre2025"]["units"]>0 and rep["2025_2026"]["units"]>0 and rep["roi95"][0]>0 and positive>negative)
(OUT/"report.json").write_text(json.dumps(rep,indent=2));print(json.dumps(rep,indent=2))
