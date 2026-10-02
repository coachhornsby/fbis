#!/usr/bin/env python3
"""CFB v3.1 residual interaction diagnostic."""
import json
from pathlib import Path
import numpy as np,pandas as pd
P=Path("artifacts/cfb-final/model-v3-1/oos-predictions.csv");OUT=Path("artifacts/cfb-final/model-v3-1/interactions.json");R=np.random.default_rng(20261002)
def band(v):
 a=abs(float(v));return "<3" if a<3 else ("3-4.99" if a<5 else ("5-6.99" if a<7 else ("7-9.99" if a<10 else "10+")))
def ci(x):
 x=np.asarray(pd.Series(x).dropna(),float)
 if len(x)<2:return [None,None]
 z=[R.choice(x,len(x),replace=True).mean() for _ in range(1000)]
 return [float(np.quantile(z,.025)),float(np.quantile(z,.975))]
def main():
 x=pd.read_csv(P);x["edge"]=x.v31_margin-x.market_margin;x=x[x.market_margin.notna()].copy()
 x["edge_band"]=x.edge.map(band);x["phase"]=np.where(x.season<=2014,"EARLY_ERA",np.where(x.season<=2019,"MID_ERA","MODERN"))
 x["direction"]=np.where(x.edge>0,"HOME","AWAY");x["regime"]=x.edge_band+"|"+x.phase+"|"+x.direction
 rows=[]
 for reg,g in x.groupby("regime"):
  d=g[g.season<=2024];h=g[g.season>2024]
  def s(a):
   r=(a.actual_margin-a.market_margin).abs()-(a.actual_margin-a.v31_margin).abs()
   return {"n":len(a),"residualAdvantage":float(r.mean()) if len(a) else None,"ci95":ci(r)}
  ds,hs=s(d),s(h);ok=ds["n"]>=150 and hs["n"]>=40 and ds["residualAdvantage"]>0 and hs["residualAdvantage"]>0 and ds["ci95"][0] is not None and ds["ci95"][0]>0
  rows.append({"regime":reg,"discovery":ds,"holdout":hs,"status":"VERIFIED" if ok else "RESEARCH"})
 verified=[r for r in rows if r["status"]=="VERIFIED"]
 out={"modelId":"CFB-FBIS-v3.1-research","predeclaredInteraction":"abs disagreement × historical era × edge direction","verifiedCount":len(verified),"verified":verified,"canQualify":False,"all":rows}
 OUT.write_text(json.dumps(out,indent=2));print(json.dumps({k:v for k,v in out.items() if k!="all"},indent=2))
if __name__=="__main__":main()
