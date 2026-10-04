#!/usr/bin/env python3
"""CFB v8.1 spread authorization research.

Purpose: test a predeclared conservative selector around v8's moderate-confidence
spread region. No totals. No threshold optimization on 2025/26 outcomes.

Candidate rule:
- v8 walk-forward p(win) in [0.5338, 0.5538)
- suppress extreme v6/market disagreement: abs(edge) < 12
- minimum abs(edge) >= 2
Report season economics and bootstrap CI for units/ROI/win rate.
"""
from pathlib import Path
import json, numpy as np, pandas as pd

SRC=Path("artifacts/cfb-final/wager-v8/walkforward-wager-scores.csv")
OUT=Path("artifacts/cfb-final/wager-v81");OUT.mkdir(parents=True,exist_ok=True)
LO=110/210+.01
HI=110/210+.03

def grade(q):
    W=int(((q.win==1)&(~q.push)).sum());L=int(((q.win==0)&(~q.push)).sum());P=int(q.push.sum())
    u=W/1.1-L;r=W+L
    return {"bets":int(len(q)),"wins":W,"losses":L,"pushes":P,"winRate":W/r if r else None,
            "units":u,"roiOnRisk":u/r if r else None,"avgP":float(q.p_win.mean()) if len(q) else None,
            "avgEdge":float(q.edge.abs().mean()) if len(q) else None}

def boot(q,B=10000,seed=81):
    q=q[~q.push].reset_index(drop=True)
    if len(q)<2:return None
    rng=np.random.default_rng(seed);vals=[]
    w=q.win.to_numpy()
    for _ in range(B):
        z=w[rng.integers(0,len(w),len(w))]
        W=z.sum();L=len(z)-W;u=W/1.1-L
        vals.append([W/len(z),u,u/len(z)])
    a=np.asarray(vals)
    return {"winRate95":np.quantile(a[:,0],[.025,.975]).tolist(),
            "units95":np.quantile(a[:,1],[.025,.975]).tolist(),
            "roi95":np.quantile(a[:,2],[.025,.975]).tolist()}

def main():
    x=pd.read_csv(SRC);x=x[x.kind=="spread"].copy()
    # Fixed before inspecting this script's outcomes.
    q=x[(x.p_win>=LO)&(x.p_win<HI)&(x.edge.abs()>=2)&(x.edge.abs()<12)].copy()
    rep={"version":"CFB-WAGER-v8.1","marketInformed":True,"canAuthorize":False,
         "rule":{"pMin":LO,"pMaxExclusive":HI,"absEdgeMin":2,"absEdgeMaxExclusive":12,
                 "rationale":"moderate-confidence spread band; extreme-disagreement suppression"},
         "overall":grade(q),"bootstrap":boot(q),"bySeason":[]}
    for y,g in q.groupby("season"):
        rep["bySeason"].append({"season":int(y),**grade(g)})
    for name,mask in [("through2024",q.season<=2024),("validation2025",q.season==2025),("prospectiveLike2026",q.season==2026),("validation2025_2026",q.season>=2025)]:
        z=q[mask];rep[name]={**grade(z),"bootstrap":boot(z)}
    # Authorization is intentionally hard: positive 95% ROI lower bound in 2025-26,
    # positive units in BOTH 2025 and 2026, >=100 bets combined.
    h=rep["validation2025_2026"];a=rep["validation2025"];b=rep["prospectiveLike2026"]
    rep["passesResearchAuthorizationGate"]=bool(h["bets"]>=100 and h["bootstrap"] and h["bootstrap"]["roi95"][0]>0 and a["units"]>0 and b["units"]>0)
    (OUT/"report.json").write_text(json.dumps(rep,indent=2));q.to_csv(OUT/"selected-bets.csv",index=False);print(json.dumps(rep,indent=2))
if __name__=="__main__":main()
