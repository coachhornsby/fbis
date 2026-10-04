#!/usr/bin/env python3
"""CFB-FBIS-v7: market-independent sequential offense/defense rating challenger."""
from pathlib import Path
import json, numpy as np, pandas as pd
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, accuracy_score
SRC=Path("artifacts/cfb-final/v5-context/cfb_v5_context.csv")
V6=Path("artifacts/cfb-control/model-v6/oos-predictions.csv")
OUT=Path("artifacts/cfb-final/model-v7");OUT.mkdir(parents=True,exist_ok=True)
def n(x): return pd.to_numeric(x,errors="coerce")
def truth(v): return str(v).strip().lower() in {"1","true","yes","y"}
def pick(d,names): return next((x for x in names if x in d),None)
def metrics(d,pm,pt):
 return {"n":int(len(d)),"marginMae":float(mean_absolute_error(d.actual_margin,pm)),"totalMae":float(mean_absolute_error(d.actual_total,pt)),"winnerAccuracy":float(accuracy_score(d.actual_margin>0,np.asarray(pm)>0))}
def build_states(d,k=.12,carry=.65,hfa_mode="national"):
 rows=[]; prior_o={};prior_d={};prior_h={}
 nc=pick(d,["neutral_site","neutralSite","neutral"])
 for season,sg in d.sort_values(["season","week","game_id"]).groupby("season",sort=True):
  O={t:carry*v for t,v in prior_o.items()};D={t:carry*v for t,v in prior_d.items()}
  H={t:{"sum":carry*v.get("sum",0.),"n":carry*v.get("n",0.)} for t,v in prior_h.items()}
  for week,wg in sg.groupby("week",sort=True):
   snap={}
   for _,r in wg.iterrows():
    h=str(r.home_id);a=str(r.away_id);neutral=truth(r.get(nc,False)) if nc else False
    oh,dh=O.get(h,0.),D.get(h,0.);oa,da=O.get(a,0.),D.get(a,0.)
    hs=H.get(h,{"sum":0.,"n":0.}); team_adj=hs["sum"]/(hs["n"]+12.) if hfa_mode=="shrink" else 0.
    hfa=0. if neutral else 2.5+team_adj
    pred_h=27.+oh-da+hfa/2;pred_a=27.+oa-dh-hfa/2
    rows.append({"game_id":r.game_id,"season":season,"week":r.week,"v7_raw_margin":pred_h-pred_a,"v7_raw_total":pred_h+pred_a,
      "v7_off_diff":oh-oa,"v7_def_diff":dh-da,"v7_off_sum":oh+oa,"v7_def_sum":dh+da,"v7_hfa":hfa})
    snap[r.game_id]=(h,a,oh,dh,oa,da,hfa,neutral)
   do={};dd={};co={}
   for _,r in wg.iterrows():
    if pd.isna(r.home_score) or pd.isna(r.away_score): continue
    h,a,oh,dh,oa,da,hfa,neutral=snap[r.game_id];hs=float(r.home_score);as_=float(r.away_score)
    ph=27.+oh-da+hfa/2;pa=27.+oa-dh-hfa/2
    eh=np.clip(hs-ph,-28,28);ea=np.clip(as_-pa,-28,28)
    # split scoring residual between own offense and opponent defense, after all same-week predictions are frozen
    for t,val in [(h,k*eh/2),(a,k*ea/2)]: do[t]=do.get(t,0)+val;co[t]=co.get(t,0)+1
    for t,val in [(a,-k*eh/2),(h,-k*ea/2)]: dd[t]=dd.get(t,0)+val
    if not neutral:
     resid=np.clip((hs-as_)-((oh-oa)+(dh-da))-2.5,-21,21);z=H.get(h,{"sum":0.,"n":0.});H[h]={"sum":z["sum"]+resid,"n":z["n"]+1}
   for t in set(O)|set(do): O[t]=O.get(t,0)+do.get(t,0)/max(co.get(t,1),1)
   for t in set(D)|set(dd): D[t]=D.get(t,0)+dd.get(t,0)/max(co.get(t,1),1)
  prior_o,prior_d,prior_h=O,D,H
 return pd.DataFrame(rows)
def calibrate(train,test):
 # train-only calibration of rating outputs; no market features
 fm=["v7_off_diff","v7_def_diff","v7_hfa"];ft=["v7_off_sum","v7_def_sum","v7_hfa"]
 mm=Ridge(alpha=30).fit(train[fm],train.actual_margin);tm=Ridge(alpha=30).fit(train[ft],train.actual_total)
 return mm.predict(test[fm]),tm.predict(test[ft])
def main():
 d=pd.read_csv(SRC,low_memory=False);d["season"]=n(d.season).astype(int);d["week"]=n(d.week)
 d["actual_margin"]=n(d.home_score)-n(d.away_score);d["actual_total"]=n(d.home_score)+n(d.away_score)
 d=d[d.actual_margin.notna()&d.actual_total.notna()].copy()
 # Predeclared research grid, selected only by previous-season validation inside each OOS fold.
 candidates=[]
 for k in [.06,.10,.14,.18]:
  for carry in [.45,.65,.80]:
   for hm in ["national","shrink"]:
    s=build_states(d,k,carry,hm);c=d[["game_id","season","actual_margin","actual_total"]].merge(s,on=["game_id","season"])
    candidates.append((k,carry,hm,c))
 rows=[];folds=[]
 for season in range(2010,2027):
  best=None
  for k,carry,hm,c in candidates:
   tr=c[c.season<season];val=tr[tr.season==season-1];fit=tr[tr.season<season-1]
   if len(fit)<2000 or len(val)<100: continue
   pm,pt=calibrate(fit,val);score=mean_absolute_error(val.actual_margin,pm)+mean_absolute_error(val.actual_total,pt)
   if best is None or score<best[0]: best=(score,k,carry,hm,c)
  if best is None: continue
  _,k,carry,hm,c=best;tr=c[c.season<season];te=c[c.season==season]
  pm,pt=calibrate(tr,te)
  rows.append(pd.DataFrame({"season":season,"game_id":te.game_id,"actual_margin":te.actual_margin,"actual_total":te.actual_total,"v7_margin":pm,"v7_total":pt}))
  folds.append({"season":season,"k":k,"carry":carry,"hfa":hm,"validationScore":best[0],"testN":len(te)})
 p=pd.concat(rows,ignore_index=True)
 # attach market reference only after predictions are frozen
 refs=d[["game_id"]+[c for c in ["benchmark_home_spread","benchmark_total"] if c in d]].copy()
 p=p.merge(refs,on="game_id",how="left");p["market_margin"]=-n(p.get("benchmark_home_spread"));p["market_total"]=n(p.get("benchmark_total"))
 report={"modelId":"CFB-FBIS-v7-RATING-CAL-research","marketInformed":False,"canQualify":False,
  "design":"sequential offense/defense ratings, postgame-only weekly updates, cross-season shrinkage, fold-selected national-vs-shrunk HFA, train-only Ridge calibration",
  "overall":metrics(p,p.v7_margin,p.v7_total),"folds":folds}
 mk=p.dropna(subset=["market_margin","market_total"]);report["marketPaired"]={"v7":metrics(mk,mk.v7_margin,mk.v7_total),"market":metrics(mk,mk.market_margin,mk.market_total)}
 h=mk[mk.season>=2025];report["holdout2025_2026"]={"v7":metrics(h,h.v7_margin,h.v7_total),"market":metrics(h,h.market_margin,h.market_total)}
 if V6.exists():
  q=pd.read_csv(V6)[["game_id","v6_margin","v6_total"]];z=p.merge(q,on="game_id");zh=z[z.season>=2025]
  report["v6Paired"]={"n":len(z),"v7":metrics(z,z.v7_margin,z.v7_total),"v6":metrics(z,z.v6_margin,z.v6_total),
   "holdout2025_2026":{"v7":metrics(zh,zh.v7_margin,zh.v7_total),"v6":metrics(zh,zh.v6_margin,zh.v6_total)}}
 p.to_csv(OUT/"oos-predictions.csv",index=False);(OUT/"report.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=="__main__": main()
