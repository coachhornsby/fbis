#!/usr/bin/env python3
"""CFB FBIS v8 wager-selection layer.

Execution/calibration layer only. The independent v6 projection remains market-free.
This layer is explicitly market-informed and may NEVER be used as a projection input.

Walk-forward rules:
- each season is scored using calibrators trained only on prior seasons;
- pushes are excluded from binary calibration but preserved in economics;
- candidate direction comes from the sign of v6 minus market;
- probability calibration uses only information available pre-bet;
- authorization requires estimated probability to clear -110 break-even plus a fixed safety margin.
"""
from pathlib import Path
import json, math
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

SRC=Path("artifacts/cfb-control/model-v6/oos-predictions.csv")
OUT=Path("artifacts/cfb-final/wager-v8");OUT.mkdir(parents=True,exist_ok=True)
BREAKEVEN=110/210
SAFETY=[0.00,0.01,0.02,0.03,0.04,0.05]

def n(x): return pd.to_numeric(x,errors="coerce")

def make_rows(d,kind):
    if kind=="spread":
        model=n(d.v6_margin); market=n(d.market_margin); actual=n(d.actual_margin)
        edge=model-market; result=actual-market
        side=np.sign(edge)
        push=np.isclose(result,0)
        win=(np.sign(result)==side) & (~push)
        X=pd.DataFrame({
            "abs_edge":edge.abs(),
            "edge_sq":np.minimum(edge.abs(),14.0)**2,
            "signed_edge":edge.clip(-14,14),
            "market_abs":market.abs(),
            "model_abs":model.abs(),
            "market_total":n(d.market_total),
            "total_disagree_abs":(n(d.v6_total)-n(d.market_total)).abs(),
            "home_edge":(edge>0).astype(float),
            "market_home_fav":(market>0).astype(float),
        })
    else:
        model=n(d.v6_total); market=n(d.market_total); actual=n(d.actual_total)
        edge=model-market; result=actual-market
        side=np.sign(edge)
        push=np.isclose(result,0)
        win=(np.sign(result)==side) & (~push)
        X=pd.DataFrame({
            "abs_edge":edge.abs(),
            "edge_sq":np.minimum(edge.abs(),14.0)**2,
            "signed_edge":edge.clip(-14,14),
            "market_total":market,
            "model_total":model,
            "market_margin_abs":n(d.market_margin).abs(),
            "margin_disagree_abs":(n(d.v6_margin)-n(d.market_margin)).abs(),
            "over_edge":(edge>0).astype(float),
        })
    z=X.copy()
    z["season"]=n(d.season).astype(int).values
    z["game_id"]=d.game_id.values
    z["edge"]=edge.values
    z["push"]=np.asarray(push)
    z["win"]=np.asarray(win,dtype=int)
    return z.replace([np.inf,-np.inf],np.nan)

def fit_predict_walkforward(z,kind):
    feature_cols=[c for c in z.columns if c not in {"season","game_id","edge","push","win"}]
    rows=[]; folds=[]
    for season in sorted(z.season.unique()):
        tr=z[(z.season<season)&(~z.push)&z[feature_cols].notna().all(axis=1)]
        te=z[(z.season==season)&z[feature_cols].notna().all(axis=1)]
        if len(tr)<1500 or len(te)==0: continue
        # mild regularization; no threshold tuning against the test season
        m=make_pipeline(StandardScaler(),LogisticRegression(C=.25,max_iter=2000,class_weight=None))
        m.fit(tr[feature_cols],tr.win)
        p=m.predict_proba(te[feature_cols])[:,1]
        o=te[["season","game_id","edge","push","win"]].copy()
        o["kind"]=kind;o["p_win"]=p
        rows.append(o)
        folds.append({"season":int(season),"trainN":int(len(tr)),"testN":int(len(te))})
    return pd.concat(rows,ignore_index=True),folds

def economics(x,margin):
    q=x[(x.edge.abs()>1e-12)&(x.p_win>=BREAKEVEN+margin)].copy()
    W=int(((q.win==1)&(~q.push)).sum());L=int(((q.win==0)&(~q.push)).sum());P=int(q.push.sum())
    units=W/1.1-L
    risk=W+L
    return {"safetyMargin":margin,"minProbability":BREAKEVEN+margin,"bets":int(len(q)),"wins":W,"losses":L,"pushes":P,
            "winRate":W/risk if risk else None,"units":units,"roiOnRisk":units/risk if risk else None,
            "avgEstimatedProb":float(q.p_win.mean()) if len(q) else None,"avgAbsEdge":float(q.edge.abs().mean()) if len(q) else None}

def calibration(x):
    q=x[~x.push].copy();q["bin"]=pd.cut(q.p_win,[0,.50,.525,.55,.575,.60,.65,1],include_lowest=True)
    out=[]
    for b,g in q.groupby("bin",observed=True):
        out.append({"bin":str(b),"n":int(len(g)),"estimated":float(g.p_win.mean()),"actual":float(g.win.mean())})
    return out

def main():
    d=pd.read_csv(SRC).dropna(subset=["v6_margin","v6_total","market_margin","market_total","actual_margin","actual_total"])
    allout=[];report={"version":"CFB-WAGER-v8","role":"execution-calibration","marketInformed":True,
      "projectionModel":"CFB-FBIS-v6 frozen control","breakEvenMinus110":BREAKEVEN,
      "governance":"This layer may select wagers but may not feed market information back into the independent projection model."}
    for kind in ["spread","total"]:
        z=make_rows(d,kind);o,folds=fit_predict_walkforward(z,kind);allout.append(o)
        report[kind]={"folds":folds,"overall":{"economics":[economics(o,m) for m in SAFETY],"calibration":calibration(o)}}
        for scope,mask in [("through2024",o.season<=2024),("validation2025_2026",o.season>=2025)]:
            q=o[mask]
            report[kind][scope]={"economics":[economics(q,m) for m in SAFETY],"calibration":calibration(q)}
    bets=pd.concat(allout,ignore_index=True);bets.to_csv(OUT/"walkforward-wager-scores.csv",index=False)
    (OUT/"report.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=="__main__": main()
