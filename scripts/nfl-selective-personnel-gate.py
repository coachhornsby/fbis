#!/usr/bin/env python3
"""Nested selective personnel gate for NFL-PRO-v1.1.

Uses the common OOS rows emitted by nfl-persistent-personnel-ablation.py.
For each test season, the gate is selected ONLY from prior OOS seasons.
If the gate fires, use the persistent-personnel challenger margin.
Otherwise retain NFL-PRO-v1.1. Totals are always left at the baseline.
"""
from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, accuracy_score, brier_score_loss, log_loss

ROOT=Path("artifacts/nfl-persistent-personnel-ablation")
IN=ROOT/"oos_predictions.csv"
OUT=ROOT/"selective-gate-report.json"
ROWS=ROOT/"selective-gate-oos.csv"

QB_THRESH=[0.05,0.10,0.15,0.20,0.30]
RG_THRESH=[0.20,0.35,0.50,0.75,1.00]

def normal_cdf(z):
    a=np.asarray(z,dtype=float)
    return np.vectorize(lambda x:.5*(1+math.erf(x/math.sqrt(2))))(a)

def metrics(df,margin_col):
    y=pd.to_numeric(df.actual_margin,errors="coerce")
    p=pd.to_numeric(df[margin_col],errors="coerce")
    out={
      "n":int(len(df)),
      "marginMae":float(mean_absolute_error(y,p)),
      "winnerAccuracy":float(accuracy_score(y>0,p>0)),
    }
    sigma=float(np.std(y-p,ddof=1)) if len(df)>1 else 13.5
    probs=np.clip(normal_cdf(p/max(sigma,1e-6)),.01,.99)
    labels=(y>0).astype(int)
    out["brier"]=float(brier_score_loss(labels,probs))
    out["logLoss"]=float(log_loss(labels,probs,labels=[0,1]))
    return out

def gate_mask(df,spec):
    q=pd.to_numeric(df.combined_qb_burden,errors="coerce").fillna(0)
    r=pd.to_numeric(df.combined_replacement_gap,errors="coerce").fillna(0)
    if spec["kind"]=="qb":return q>=spec["qb"]
    if spec["kind"]=="replacement":return r>=spec["replacement"]
    if spec["kind"]=="or":return (q>=spec["qb"])|(r>=spec["replacement"])
    if spec["kind"]=="and":return (q>=spec["qb"])&(r>=spec["replacement"])
    return pd.Series(False,index=df.index)

def candidates():
    out=[{"id":"NONE","kind":"none"}]
    out += [{"id":f"QB>={q:.2f}","kind":"qb","qb":q} for q in QB_THRESH]
    out += [{"id":f"RG>={r:.2f}","kind":"replacement","replacement":r} for r in RG_THRESH]
    for q in QB_THRESH:
      for r in RG_THRESH:
        out.append({"id":f"QB>={q:.2f}_OR_RG>={r:.2f}","kind":"or","qb":q,"replacement":r})
        out.append({"id":f"QB>={q:.2f}_AND_RG>={r:.2f}","kind":"and","qb":q,"replacement":r})
    return out

def apply(df,spec):
    z=df.copy()
    mask=gate_mask(z,spec) if spec["kind"]!="none" else pd.Series(False,index=z.index)
    z["selective_margin"]=np.where(mask,z.chall_margin,z.v11_margin)
    z["gate_fired"]=mask.astype(int)
    z["gate_id"]=spec["id"]
    return z

def objective(m,base,fire_rate):
    # Predeclared score: prioritize margin MAE, require calibration not to materially degrade,
    # and mildly penalize broad gates so the overlay stays selective.
    return (m["marginMae"]-base["marginMae"]) + 2.0*max(0,m["brier"]-base["brier"]) + .03*fire_rate

def main():
    d=pd.read_csv(IN,low_memory=False).sort_values(["season","week","game_id"]).reset_index(drop=True)
    folds=[];rows=[]
    seasons=sorted(int(x) for x in d.season.dropna().unique())
    for season in seasons:
        train=d[d.season<season].copy()
        test=d[d.season==season].copy()
        if len(train)<400 or len(test)<50:continue
        base_train=metrics(train,"v11_margin")
        scored=[]
        for spec in candidates():
            z=apply(train,spec)
            m=metrics(z,"selective_margin")
            rate=float(z.gate_fired.mean())
            # Don't let a "selective" gate become a near-global overlay.
            if spec["kind"]!="none" and (rate<.03 or rate>.40):continue
            scored.append({"spec":spec,"metrics":m,"fireRate":rate,"objective":objective(m,base_train,rate)})
        choice=min(scored,key=lambda x:x["objective"])
        z=apply(test,choice["spec"])
        bm=metrics(z,"v11_margin");sm=metrics(z,"selective_margin")
        folds.append({
          "season":season,"n":int(len(z)),"selectedGate":choice["spec"],"trainFireRate":choice["fireRate"],
          "testFireRate":float(z.gate_fired.mean()),"baseline":bm,"selective":sm,
          "delta":{"marginMae":sm["marginMae"]-bm["marginMae"],"winnerAccuracy":sm["winnerAccuracy"]-bm["winnerAccuracy"],"brier":sm["brier"]-bm["brier"]}
        })
        rows.append(z)
    oos=pd.concat(rows,ignore_index=True)
    base=metrics(oos,"v11_margin");sel=metrics(oos,"selective_margin")
    fired=oos[oos.gate_fired.eq(1)]
    fire_base=metrics(fired,"v11_margin") if len(fired) else None
    fire_sel=metrics(fired,"selective_margin") if len(fired) else None
    report={
      "experiment":"NFL-PRO-v1.1 selective persistent-personnel margin overlay",
      "design":"Gate choice is nested: each test season uses only prior OOS seasons to choose among QB-burden/replacement-gap thresholds. Totals remain NFL-PRO-v1.1.",
      "sample":{"startSeason":int(oos.season.min()),"endSeason":int(oos.season.max()),"n":int(len(oos))},
      "baseline":base,"selective":sel,
      "delta":{"marginMae":sel["marginMae"]-base["marginMae"],"winnerAccuracy":sel["winnerAccuracy"]-base["winnerAccuracy"],"brier":sel["brier"]-base["brier"],"logLoss":sel["logLoss"]-base["logLoss"]},
      "gateUsage":{"n":int(len(fired)),"rate":float(len(fired)/len(oos)) if len(oos) else 0,"baselineOnFired":fire_base,"selectiveOnFired":fire_sel},
      "folds":folds,
      "promotionEvidencePass":bool(sel["marginMae"]<base["marginMae"] and sel["brier"]<=base["brier"] and sel["winnerAccuracy"]>=base["winnerAccuracy"]),
      "promotionRule":"Lower margin MAE, non-worse Brier, and non-worse winner accuracy on nested OOS sample. Production promotion still requires prospective stability.",
      "totalsPolicy":"UNCHANGED_BASELINE",
      "marketInformed":False,
    }
    OUT.write_text(json.dumps(report,indent=2))
    oos.to_csv(ROWS,index=False)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    main()
