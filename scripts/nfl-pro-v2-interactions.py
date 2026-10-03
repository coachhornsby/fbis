#!/usr/bin/env python3
"""NFL-PRO-v2 residual interaction diagnostic. Research-only; no threshold mining."""
import json
from pathlib import Path
import numpy as np,pandas as pd
P=Path("artifacts/nfl-pro-v2/oos-predictions.csv");D=Path("artifacts/nfl/nfl_game_training_2015_2026.csv")
OUT=Path("artifacts/nfl-pro-v2/interactions.json");R=np.random.default_rng(20261002)
def n(s):return pd.to_numeric(s,errors="coerce")
def band(v):
 a=abs(float(v));return "<3" if a<3 else ("3-4.99" if a<5 else ("5-6.99" if a<7 else "7+"))
def ci(x):
 x=np.asarray(pd.Series(x).dropna(),float)
 if len(x)<2:return [None,None]
 z=[R.choice(x,len(x),replace=True).mean() for _ in range(1000)]
 return [float(np.quantile(z,.025)),float(np.quantile(z,.975))]
def main():
 p=pd.read_csv(P);d=pd.read_csv(D,low_memory=False)
 keep=["game_id","week","div_game","home_rest","away_rest","wind","temp"]
 x=p.merge(d[keep].drop_duplicates("game_id"),on="game_id",how="left")
 x["edge"]=x.v2_margin-x.market_margin;x["edge_band"]=x.edge.map(band)
 x["phase"]=np.where(n(x.week)<=4,"EARLY",np.where(n(x.week)<=12,"MID","LATE"))
 x["rest"]=np.where(n(x.home_rest)-n(x.away_rest)>=2,"HOME_EDGE",np.where(n(x.home_rest)-n(x.away_rest)<=-2,"AWAY_EDGE","EVEN"))
 x["weather"]=np.where((n(x.wind)>=15)|(n(x.temp)<=32),"ADVERSE","NORMAL")
 x["division"]=np.where(n(x.div_game).fillna(0)>0,"DIV","NON_DIV")
 x["direction"]=np.where(x.edge>0,"HOME","AWAY")
 x["regime"]=x.edge_band+"|"+x.phase+"|"+x.direction
 rows=[]
 for reg,g in x.groupby("regime"):
  disc=g[g.season<=2024];hold=g[g.season>2024]
  def s(a):
   r=(a.actual_margin-a.market_margin).abs()-(a.actual_margin-a.v2_margin).abs()
   return {"n":len(a),"residualAdvantage":float(r.mean()) if len(a) else None,"ci95":ci(r)}
  ds,hs=s(disc),s(hold)
  ok=ds["n"]>=75 and hs["n"]>=20 and ds["residualAdvantage"]>0 and hs["residualAdvantage"]>0 and ds["ci95"][0] is not None and ds["ci95"][0]>0
  rows.append({"regime":reg,"discovery":ds,"holdout":hs,"status":"VERIFIED" if ok else "RESEARCH"})
 verified=[r for r in rows if r["status"]=="VERIFIED"]
 out={"modelId":"NFL-PRO-v2","predeclaredInteraction":"abs disagreement band × season phase × edge direction",
      "verifiedCount":len(verified),"verified":verified,"all":rows,"canQualify":False}
 OUT.write_text(json.dumps(out,indent=2));print(json.dumps({k:v for k,v in out.items() if k!="all"},indent=2))
if __name__=="__main__":main()
