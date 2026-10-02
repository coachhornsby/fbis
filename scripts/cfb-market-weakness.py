#!/usr/bin/env python3
"""Leakage-safe CFB market-weakness research using frozen CFB-v3 true OOS predictions."""
import json
from pathlib import Path
import numpy as np
import pandas as pd

OOS=Path("artifacts/cfb-final/model/cfb_v3_oos_predictions.csv")
DATA=Path("artifacts/cfb-final/cfb_training_full_enriched_2004_2026.csv")
OUT=Path("artifacts/cfb-market-weakness"); OUT.mkdir(parents=True,exist_ok=True)
DISCOVERY_END=2024; MIN_DISCOVERY=150; MIN_HOLDOUT=40; BOOT=2000
RNG=np.random.default_rng(20261002)

def num(s): return pd.to_numeric(s,errors="coerce")
def edge_band(v):
    a=abs(float(v))
    if a<1:return "<1"
    if a<2:return "1-1.99"
    if a<3:return "2-2.99"
    if a<4:return "3-3.99"
    if a<5:return "4-4.99"
    if a<7:return "5-6.99"
    return "7+"
def spread_band(v):
    a=abs(float(v))
    if a<3:return "0-2.5"
    if a<7:return "3-6.5"
    if a<10:return "7-9.5"
    if a<14:return "10-13.5"
    if a<21:return "14-20.5"
    return "21+"
def phase(v):
    w=float(v); return "EARLY" if w<=4 else ("MID" if w<=10 else "LATE")
def ci(x):
    x=np.asarray(pd.Series(x).dropna(),float)
    if len(x)<2:return [None,None]
    z=np.array([RNG.choice(x,len(x),replace=True).mean() for _ in range(BOOT)])
    return [float(np.quantile(z,.025)),float(np.quantile(z,.975))]
def summary(g,market):
    if market=="spread":
        ma=(g.actual_margin-g.model_margin).abs(); mk=(g.actual_margin-g.market_margin).abs()
        e=g.model_margin-g.market_margin; side=np.where(e>0,1,-1); result=(g.actual_margin-g.market_margin)*side
    else:
        ma=(g.actual_total-g.model_total).abs(); mk=(g.actual_total-g.market_total).abs()
        e=g.model_total-g.market_total; side=np.where(e>0,1,-1); result=(g.actual_total-g.market_total)*side
    residual=mk-ma; w=int((result>0).sum()); l=int((result<0).sum()); p=int((result==0).sum()); n=w+l
    units=w*(100/110)-l
    return {"n":int(len(g)),"modelMae":float(ma.mean()),"marketMae":float(mk.mean()),
      "residualAdvantage":float(residual.mean()),"residualAdvantage95CI":ci(residual),
      "avgAbsDisagreement":float(np.abs(e).mean()),"wins":w,"losses":l,"pushes":p,
      "atsHitRate":float(w/n) if n else None,"flat110Units":float(units),"flat110Roi":float(units/n) if n else None}
def eval_cut(df,market,f,v):
    g=df[df[f].astype(str)==str(v)]; d=g[g.season<=DISCOVERY_END]; h=g[g.season>DISCOVERY_END]
    ds=summary(d,market) if len(d) else None; hs=summary(h,market) if len(h) else None
    ok=bool(ds and hs and ds["n"]>=MIN_DISCOVERY and hs["n"]>=MIN_HOLDOUT and ds["residualAdvantage"]>0 and
            hs["residualAdvantage"]>0 and ds["residualAdvantage95CI"][0] is not None and ds["residualAdvantage95CI"][0]>0)
    return {"market":market,"feature":f,"value":str(v),"discovery":ds,"holdout":hs,"status":"VERIFIED" if ok else "RESEARCH"}

def main():
    o=pd.read_csv(OOS,low_memory=False); d=pd.read_csv(DATA,low_memory=False)
    base=["game_id","week","neutral_site","benchmark_home_spread","benchmark_total","benchmark_spread_source","benchmark_total_source"]
    optional=["home_team","away_team","home_conference","away_conference","home_classification","away_classification"]
    keep=[c for c in base+optional if c in d.columns]
    x=o.merge(d[keep].drop_duplicates("game_id"),on="game_id",how="left",validate="many_to_one",suffixes=("","_data"))
    x["season"]=num(x.season).astype(int); x["week"]=num(x.week)
    x["spread_edge"]=num(x.model_margin)-num(x.market_margin); x["total_edge"]=num(x.model_total)-num(x.market_total)
    x["spread_edge_band"]=x.spread_edge.map(edge_band); x["total_edge_band"]=x.total_edge.map(edge_band)
    x["spread_band"]=num(x.market_margin).map(spread_band); x["season_phase"]=x.week.map(phase)
    x["favorite_agreement"]=np.where(np.sign(x.model_margin)==np.sign(x.market_margin),"AGREE","FLIP")
    x["model_side"]=np.where(x.spread_edge>0,"HOME","AWAY")
    x["market_favorite"]=np.where(x.market_margin>0,"HOME",np.where(x.market_margin<0,"AWAY","PICK"))
    x["venue"]=np.where(num(x.get("neutral_site",pd.Series(0,index=x.index))).fillna(0).astype(bool),"NEUTRAL","HOME")
    if "home_conference" in x and "away_conference" in x:
        x["conference_game"]=np.where(x.home_conference.astype(str)==x.away_conference.astype(str),"SAME_CONFERENCE","NON_CONFERENCE")
    specs={"spread":["spread_edge_band","spread_band","season_phase","favorite_agreement","model_side","market_favorite","venue"],
           "total":["total_edge_band","season_phase","venue"]}
    if "conference_game" in x:
        specs["spread"].append("conference_game"); specs["total"].append("conference_game")
    rows=[]
    for market,features in specs.items():
        col="market_margin" if market=="spread" else "market_total"
        u=x.dropna(subset=[col])
        for f in features:
            for v in sorted(u[f].dropna().astype(str).unique()): rows.append(eval_cut(u,market,f,v))
    verified=[r for r in rows if r["status"]=="VERIFIED"]
    report={"generatedAt":pd.Timestamp.now("UTC").isoformat(),"modelId":"CFB-FBIS-v3-research",
      "design":"True walk-forward OOS predictions segmented by predeclared CFB regimes; historical benchmark market is evaluation-only.",
      "sample":{"n":int(len(x)),"spreadMarketN":int(x.market_margin.notna().sum()),"totalMarketN":int(x.market_total.notna().sum()),
        "discoveryThrough":DISCOVERY_END,"holdoutSeasons":sorted(x.loc[x.season>DISCOVERY_END,"season"].unique().tolist())},
      "thresholds":{"minDiscoveryN":MIN_DISCOVERY,"minHoldoutN":MIN_HOLDOUT,"bootstrapReplicates":BOOT,
        "verifiedRule":"positive residual advantage in discovery and holdout, discovery n>=150, holdout n>=40, discovery 95% bootstrap CI entirely >0"},
      "verifiedCount":len(verified),"verified":verified,"allCuts":rows,
      "governance":{"canQualify":False,"autoPromote":False,"closingMarketAsModelInput":False,
        "rule":"VERIFIED remains research evidence until prospective confirmation and operator-approved qualification policy."}}
    (OUT/"report.json").write_text(json.dumps(report,indent=2)); x.to_csv(OUT/"analysis-rows.csv",index=False)
    print(json.dumps({k:v for k,v in report.items() if k!="allCuts"},indent=2))
if __name__=="__main__":main()
