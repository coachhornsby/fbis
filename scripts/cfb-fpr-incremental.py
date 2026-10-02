#!/usr/bin/env python3
"""Test whether FPR adds incremental information to frozen CFB-FBIS-v4 OOS predictions.

Uses only prior-season OOS rows to fit a small ridge stack for each future season.
This preserves the original v4 predictions and the untouched 2025-26 holdout.
"""
from pathlib import Path
import json
import numpy as np,pandas as pd
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error,accuracy_score
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.impute import SimpleImputer

V4=Path("artifacts/cfb-final/model-v4/oos-predictions.csv")
FPR=Path("artifacts/cfb-final/fpr/game-fpr.csv")
OUT=Path("artifacts/cfb-final/fpr-incremental");OUT.mkdir(parents=True,exist_ok=True)

def met(a,pm,pt):
 return {"n":int(len(a)),"marginMae":float(mean_absolute_error(a.actual_margin,pm)),
 "totalMae":float(mean_absolute_error(a.actual_total,pt)),
 "winnerAccuracy":float(accuracy_score(a.actual_margin>0,np.asarray(pm)>0))}

def main():
 v=pd.read_csv(V4);f=pd.read_csv(FPR)
 f["fpr_total_env"]=f.home_fpr_o+f.away_fpr_o-f.home_fpr_d-f.away_fpr_d
 x=v.merge(f[["game_id","fpr_neutral_margin","fpr_projected_margin","home_fpr_o","home_fpr_d","home_fpr","away_fpr_o","away_fpr_d","away_fpr","fpr_total_env"]],on="game_id",how="inner")
 rows=[]
 for season in sorted(x.season.unique()):
  tr=x[x.season<season].dropna(subset=["v4_margin","v4_total","actual_margin","actual_total","fpr_projected_margin","fpr_total_env"])
  te=x[x.season==season].copy()
  if len(tr)<2500:continue
  # Small regularized stack: v4 remains anchor; FPR tests only incremental signal.
  mm=make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=100)).fit(tr[["v4_margin","fpr_projected_margin"]],tr.actual_margin)
  tm=make_pipeline(SimpleImputer(strategy="median"),StandardScaler(),Ridge(alpha=100)).fit(tr[["v4_total","fpr_total_env"]],tr.actual_total)
  te["v4_fpr_margin"]=mm.predict(te[["v4_margin","fpr_projected_margin"]])
  te["v4_fpr_total"]=tm.predict(te[["v4_total","fpr_total_env"]])
  rows.append(te)
 p=pd.concat(rows,ignore_index=True)
 base=met(p,p.v4_margin,p.v4_total);aug=met(p,p.v4_fpr_margin,p.v4_fpr_total)
 h=p[p.season>=2025];hb=met(h,h.v4_margin,h.v4_total);ha=met(h,h.v4_fpr_margin,h.v4_fpr_total)
 report={"modelId":"CFB-FBIS-v4+FPR-incremental-research","marketInformed":False,"canQualify":False,
 "method":"prior-season-only ridge stack over frozen v4 OOS predictions plus independent FPR signals",
 "overall":{"v4":base,"v4PlusFpr":aug},
 "holdout2025_2026":{"v4":hb,"v4PlusFpr":ha},
 "incrementalPass":bool(aug["marginMae"]<base["marginMae"] and aug["totalMae"]<base["totalMae"] and aug["winnerAccuracy"]>=base["winnerAccuracy"] and ha["marginMae"]<hb["marginMae"] and ha["totalMae"]<hb["totalMae"] and ha["winnerAccuracy"]>=hb["winnerAccuracy"]),
 "governance":"No market inputs. Each season's stack is fit only on earlier-season frozen OOS predictions; 2025-26 remains future holdout."}
 p.to_csv(OUT/"oos-predictions.csv",index=False);(OUT/"report.json").write_text(json.dumps(report,indent=2))
 print(json.dumps(report,indent=2))
if __name__=="__main__":main()
