#!/usr/bin/env python3
"""CFB-FBIS-v3.1: train-only interaction augmentation of the leakage-safe v3 feature space."""
import importlib.util,json
from pathlib import Path
import numpy as np,pandas as pd
spec=importlib.util.spec_from_file_location("v3","scripts/cfb-v3-walkforward.py");v3=importlib.util.module_from_spec(spec);spec.loader.exec_module(v3)
DATA=Path("artifacts/cfb-final/cfb_training_full_enriched_2004_2026.csv")
V3=Path("artifacts/cfb-final/model/cfb_v3_oos_predictions.csv")
OUT=Path("artifacts/cfb-final/model-v3-1");OUT.mkdir(parents=True,exist_ok=True)

def num(s):return pd.to_numeric(s,errors="coerce")
def augment(d):
 d=d.copy()
 # Predeclared context families: current football strength × program prior.
 football=[c for c in d if c.startswith("diff_pregame_") and any(k in c.lower() for k in ["epa","success","explosive","pass","rush","havoc","sack"])]
 context=[c for c in d if c.startswith("diff_ctx_") and any(k in c.lower() for k in ["fpi","rating","talent","returning","recruit"])]
 # Keep interactions bounded and interpretable: top coverage members, no target/market screening here.
 football=sorted(football,key=lambda c:d[c].notna().mean(),reverse=True)[:12]
 context=sorted(context,key=lambda c:d[c].notna().mean(),reverse=True)[:10]
 for a in football:
  for b in context:
   d[f"ix__{a}__X__{b}"]=num(d[a])*num(d[b])
 # Total interactions use additive pregame efficiency × additive program context.
 tf=[c for c in d if c.startswith("sum_pregame_") and any(k in c.lower() for k in ["epa","success","explosive","pass","rush"])]
 tc=[c for c in d if c.startswith("sum_ctx_") and any(k in c.lower() for k in ["fpi","rating","talent","returning","recruit"])]
 tf=sorted(tf,key=lambda c:d[c].notna().mean(),reverse=True)[:10];tc=sorted(tc,key=lambda c:d[c].notna().mean(),reverse=True)[:8]
 for a in tf:
  for b in tc:d[f"ixsum__{a}__X__{b}"]=num(d[a])*num(d[b])
 return d

def candidates(d,kind):
 base=v3.candidate_cols(d,kind)
 ix=[c for c in d if c.startswith("ix__" if kind=="margin" else "ixsum__")]
 return sorted(set(base+ix))

def main():
 d=pd.read_csv(DATA,low_memory=False);d=d[(num(d.home_score).notna())&(num(d.away_score).notna())].copy()
 d["home_margin"]=num(d.home_margin);d["final_total"]=num(d.final_total);d["season"]=num(d.season).astype(int);d["week"]=num(d.week);d=augment(d)
 mc=candidates(d,"margin");tc=candidates(d,"total");rows=[];folds=[]
 for season in range(2010,2027):
  tr=d[d.season<season];te=d[d.season==season]
  if len(tr)<2500 or len(te)==0:continue
  mf,_=v3.select_features(tr,mc,"home_margin");tf,_=v3.select_features(tr,tc,"final_total")
  if len(mf)<5 or len(tf)<5:continue
  ma=v3.tune(tr,mf,"home_margin");ta=v3.tune(tr,tf,"final_total")
  mm=v3.fit_model(tr,mf,"home_margin",ma);tm=v3.fit_model(tr,tf,"final_total",ta)
  pm=mm.predict(te[mf]);pt=tm.predict(te[tf])
  folds.append({"season":season,"marginFeatures":mf,"totalFeatures":tf,"model":v3.metrics(te,pm,pt)})
  rows.append(pd.DataFrame({"season":season,"game_id":te.game_id,"actual_margin":te.home_margin,"actual_total":te.final_total,
    "v31_margin":pm,"v31_total":pt,"market_margin":-num(te.benchmark_home_spread),"market_total":num(te.benchmark_total)}))
 o=pd.concat(rows,ignore_index=True);old=pd.read_csv(V3).rename(columns={"model_margin":"v3_margin","model_total":"v3_total"})
 p=o.merge(old[["game_id","v3_margin","v3_total"]],on="game_id",how="inner")
 a=pd.DataFrame({"home_margin":p.actual_margin,"final_total":p.actual_total})
 m31=v3.metrics(a,p.v31_margin,p.v31_total);m3=v3.metrics(a,p.v3_margin,p.v3_total)
 mk=p.dropna(subset=["market_margin","market_total"]);am=pd.DataFrame({"home_margin":mk.actual_margin,"final_total":mk.actual_total})
 market=v3.metrics(am,mk.market_margin,mk.market_total);m31mk=v3.metrics(am,mk.v31_margin,mk.v31_total)
 beats={"marginMae":m31["marginMae"]<m3["marginMae"],"totalMae":m31["totalMae"]<m3["totalMae"],"winnerAccuracy":m31["winnerAccuracy"]>m3["winnerAccuracy"]}
 report={"modelId":"CFB-FBIS-v3.1-research","design":"v3 leakage-safe base plus predeclared football-strength × program-context interactions; train-only selection",
  "sample":{"n":len(p),"startSeason":int(p.season.min()),"endSeason":int(p.season.max())},"v31":m31,"v3":m3,"marketPairedV31":m31mk,"market":market,
  "deltasVsV3":{"marginMae":m31["marginMae"]-m3["marginMae"],"totalMae":m31["totalMae"]-m3["totalMae"],"winnerAccuracy":m31["winnerAccuracy"]-m3["winnerAccuracy"]},
  "deltasVsMarket":{"marginMae":m31mk["marginMae"]-market["marginMae"],"totalMae":m31mk["totalMae"]-market["totalMae"],"winnerAccuracy":m31mk["winnerAccuracy"]-market["winnerAccuracy"]},
  "beatsV3AllThree":bool(all(beats.values())),"beatsV3":beats,"canQualify":False,"folds":folds}
 (OUT/"report.json").write_text(json.dumps(report,indent=2));p.to_csv(OUT/"oos-predictions.csv",index=False)
 print(json.dumps({k:v for k,v in report.items() if k!="folds"},indent=2))
if __name__=="__main__":main()
