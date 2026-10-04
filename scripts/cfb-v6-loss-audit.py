#!/usr/bin/env python3
import json, numpy as np, pandas as pd
from pathlib import Path
P=Path("artifacts/cfb-audit/model-v6/oos-predictions.csv")
OUT=Path("artifacts/cfb-final/v6-loss-audit");OUT.mkdir(parents=True,exist_ok=True)
d=pd.read_csv(P)
for c in ["actual_margin","actual_total","v6_margin","v6_total","market_margin","market_total","season"]: d[c]=pd.to_numeric(d[c],errors="coerce")
d=d.dropna(subset=["actual_margin","actual_total","v6_margin","v6_total","market_margin","market_total"]).copy()
d["v6_margin_err"]=(d.actual_margin-d.v6_margin).abs();d["mkt_margin_err"]=(d.actual_margin-d.market_margin).abs()
d["v6_total_err"]=(d.actual_total-d.v6_total).abs();d["mkt_total_err"]=(d.actual_total-d.market_total).abs()
d["margin_adv"]=d.mkt_margin_err-d.v6_margin_err;d["total_adv"]=d.mkt_total_err-d.v6_total_err
d["spread_abs"]=d.market_margin.abs();d["total_env"]=d.market_total
d["mm_disagree"]=(d.v6_margin-d.market_margin).abs();d["tm_disagree"]=(d.v6_total-d.market_total).abs()
d["market_side"]=np.where(d.market_margin>0,"HOME_FAV",np.where(d.market_margin<0,"AWAY_FAV","PICK"))
d["model_side"]=np.where(d.v6_margin>0,"HOME",np.where(d.v6_margin<0,"AWAY","PICK"))
d["side_agree"]=np.where(np.sign(d.v6_margin)==np.sign(d.market_margin),"AGREE","DISAGREE")
def bins(x,edges,labels): return pd.cut(x,edges,labels=labels,include_lowest=True,right=False)
d["spread_bucket"]=bins(d.spread_abs,[0,3,7,10,14,21,1e9],["0-2.5","3-6.5","7-9.5","10-13.5","14-20.5","21+"])
d["market_total_bucket"]=bins(d.total_env,[0,45,50,55,60,65,1e9],["<45","45-49.5","50-54.5","55-59.5","60-64.5","65+"])
d["margin_disagree_bucket"]=bins(d.mm_disagree,[0,1,2,3,5,7,10,1e9],["<1","1-2","2-3","3-5","5-7","7-10","10+"])
d["total_disagree_bucket"]=bins(d.tm_disagree,[0,1,2,3,5,7,10,1e9],["<1","1-2","2-3","3-5","5-7","7-10","10+"])
def summarize(col, subset):
 rows=[]
 for k,g in subset.groupby(col,observed=True):
  n=len(g)
  rows.append({"dimension":col,"segment":str(k),"n":n,
   "v6MarginMAE":g.v6_margin_err.mean(),"marketMarginMAE":g.mkt_margin_err.mean(),"marginAdv":g.margin_adv.mean(),"marginWinShare":(g.margin_adv>0).mean(),
   "v6TotalMAE":g.v6_total_err.mean(),"marketTotalMAE":g.mkt_total_err.mean(),"totalAdv":g.total_adv.mean(),"totalWinShare":(g.total_adv>0).mean()})
 return rows
dims=["spread_bucket","market_total_bucket","margin_disagree_bucket","total_disagree_bucket","market_side","side_agree","season"]
rows=[]
for scope,z in [("all",d),("through2024",d[d.season<=2024]),("2025_2026",d[d.season>=2025])]:
 for dim in dims:
  for r in summarize(dim,z): r["scope"]=scope;rows.append(r)
a=pd.DataFrame(rows)
a.to_csv(OUT/"segments.csv",index=False)
# Stability: only flag segments with >=100 games in discovery and >=50 in 2025-26, same sign advantage.
disc=a[a.scope=="through2024"];hold=a[a.scope=="2025_2026"]
z=disc.merge(hold,on=["dimension","segment"],suffixes=("_disc","_hold"))
stable=z[(z.n_disc>=100)&(z.n_hold>=50)&(np.sign(z.marginAdv_disc)==np.sign(z.marginAdv_hold))]
stableT=z[(z.n_disc>=100)&(z.n_hold>=50)&(np.sign(z.totalAdv_disc)==np.sign(z.totalAdv_hold))]
overall={"n":len(d),"margin":{"v6":d.v6_margin_err.mean(),"market":d.mkt_margin_err.mean(),"adv":d.margin_adv.mean()},"total":{"v6":d.v6_total_err.mean(),"market":d.mkt_total_err.mean(),"adv":d.total_adv.mean()}}
report={"overall":overall,
"stableMarginSegments":stable.sort_values("marginAdv_hold",ascending=False)[["dimension","segment","n_disc","marginAdv_disc","n_hold","marginAdv_hold"]].to_dict("records"),
"stableTotalSegments":stableT.sort_values("totalAdv_hold",ascending=False)[["dimension","segment","n_disc","totalAdv_disc","n_hold","totalAdv_hold"]].to_dict("records")}
(OUT/"report.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
