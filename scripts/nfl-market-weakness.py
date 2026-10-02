#!/usr/bin/env python3
"""Leakage-safe NFL market-weakness research on true OOS NFL-PRO-v1.1 predictions."""
import json
from pathlib import Path
import numpy as np
import pandas as pd

OOS=Path("artifacts/nfl-pro-v1-1/oos-predictions.csv")
DATA=Path("artifacts/nfl/nfl_game_training_2015_2026.csv")
OUT=Path("artifacts/nfl-market-weakness"); OUT.mkdir(parents=True,exist_ok=True)
DISCOVERY_END=2024
MIN_DISCOVERY=100
MIN_HOLDOUT=25
BOOT=2000
RNG=np.random.default_rng(20261002)

def num(s): return pd.to_numeric(s,errors="coerce")
def bucket_abs_edge(x):
    a=abs(float(x))
    if a<1:return "<1"
    if a<2:return "1-1.99"
    if a<3:return "2-2.99"
    if a<4:return "3-3.99"
    if a<5:return "4-4.99"
    if a<7:return "5-6.99"
    return "7+"
def spread_band(s):
    a=abs(float(s))
    if a<3:return "0-2.5"
    if a<7:return "3-6.5"
    if a<10:return "7-9.5"
    if a<14:return "10-13.5"
    return "14+"
def phase(w):
    w=float(w)
    return "EARLY" if w<=4 else ("MID" if w<=12 else "LATE")
def ci_mean(x):
    x=np.asarray(pd.Series(x).dropna(),dtype=float)
    if len(x)<2:return [None,None]
    means=np.array([RNG.choice(x,len(x),replace=True).mean() for _ in range(BOOT)])
    return [float(np.quantile(means,.025)),float(np.quantile(means,.975))]
def summarize(g,market):
    if market=="spread":
        model_abs=(g.actual_margin-g.v11_margin).abs()
        market_abs=(g.actual_margin-g.market_margin).abs()
        edge=g.v11_margin-g.market_margin
        side=np.where(edge>0,1,-1)
        ats_margin=(g.actual_margin-g.market_margin)*side
    else:
        model_abs=(g.actual_total-g.v11_total).abs()
        market_abs=(g.actual_total-g.market_total).abs()
        edge=g.v11_total-g.market_total
        side=np.where(edge>0,1,-1)
        ats_margin=(g.actual_total-g.market_total)*side
    residual=market_abs-model_abs
    wins=int((ats_margin>0).sum()); losses=int((ats_margin<0).sum()); pushes=int((ats_margin==0).sum())
    decisions=wins+losses
    units=wins*(100/110)-losses
    return {"n":int(len(g)),"modelMae":float(model_abs.mean()),"marketMae":float(market_abs.mean()),
      "residualAdvantage":float(residual.mean()),"residualAdvantage95CI":ci_mean(residual),
      "avgAbsDisagreement":float(np.abs(edge).mean()),"wins":wins,"losses":losses,"pushes":pushes,
      "atsHitRate":float(wins/decisions) if decisions else None,"flat110Units":float(units),
      "flat110Roi":float(units/decisions) if decisions else None}
def evaluate(df,market,feature,value):
    g=df[df[feature].astype(str)==str(value)]
    d=g[g.season<=DISCOVERY_END]; h=g[g.season>DISCOVERY_END]
    ds=summarize(d,market) if len(d) else None; hs=summarize(h,market) if len(h) else None
    verified=bool(ds and hs and ds["n"]>=MIN_DISCOVERY and hs["n"]>=MIN_HOLDOUT and
                  ds["residualAdvantage"]>0 and hs["residualAdvantage"]>0 and
                  ds["residualAdvantage95CI"][0] is not None and ds["residualAdvantage95CI"][0]>0)
    return {"market":market,"feature":feature,"value":str(value),"discovery":ds,"holdout":hs,
            "status":"VERIFIED" if verified else "RESEARCH"}

def main():
    o=pd.read_csv(OOS); d=pd.read_csv(DATA,low_memory=False)
    keep=["game_id","week","home_team","away_team","location","home_rest","away_rest","temp","wind","closing_home_spread","closing_total"]
    x=o.merge(d[keep].drop_duplicates("game_id"),on="game_id",how="left",validate="one_to_one")
    x["season"]=num(x.season).astype(int); x["week"]=num(x.week)
    x["closing_home_spread"]=num(x.closing_home_spread); x["closing_total"]=num(x.closing_total)
    x["spread_edge"]=num(x.v11_margin)-num(x.market_margin)
    x["total_edge"]=num(x.v11_total)-num(x.market_total)
    x["spread_edge_band"]=x.spread_edge.map(bucket_abs_edge)
    x["total_edge_band"]=x.total_edge.map(bucket_abs_edge)
    x["spread_band"]=x.closing_home_spread.map(spread_band)
    x["season_phase"]=x.week.map(phase)
    x["model_market_favorite"]=np.where(np.sign(x.v11_margin)==np.sign(x.market_margin),"AGREE","FLIP")
    x["model_side"]=np.where(x.spread_edge>0,"HOME","AWAY")
    x["market_favorite"]=np.where(x.market_margin>0,"HOME",np.where(x.market_margin<0,"AWAY","PICK"))
    x["rest_diff"]=num(x.home_rest)-num(x.away_rest)
    x["rest_regime"]=np.where(x.rest_diff>=2,"HOME_REST_EDGE",np.where(x.rest_diff<=-2,"AWAY_REST_EDGE","EVEN"))
    x["venue"]=np.where(x.location.astype(str).str.lower().eq("neutral"),"NEUTRAL","HOME")
    x["weather_regime"]=np.where((num(x.wind)>=15)|(num(x.temp)<=32),"ADVERSE","NORMAL")

    specs={"spread":["spread_edge_band","spread_band","season_phase","model_market_favorite","model_side","market_favorite","rest_regime","venue","weather_regime"],
           "total":["total_edge_band","season_phase","rest_regime","venue","weather_regime"]}
    rows=[]
    for market,features in specs.items():
        usable=x.dropna(subset=["market_margin" if market=="spread" else "market_total"])
        for f in features:
            for v in sorted(usable[f].dropna().astype(str).unique()): rows.append(evaluate(usable,market,f,v))
    verified=[r for r in rows if r["status"]=="VERIFIED"]
    report={"generatedAt":pd.Timestamp.utcnow().isoformat(),"modelId":"NFL-PRO-v1.1",
      "design":"True walk-forward OOS predictions segmented by predeclared contemporaneous regimes; closing line is evaluation-only.",
      "sample":{"n":int(len(x)),"discoveryThrough":DISCOVERY_END,"holdoutSeasons":sorted(x.loc[x.season>DISCOVERY_END,"season"].unique().tolist())},
      "thresholds":{"minDiscoveryN":MIN_DISCOVERY,"minHoldoutN":MIN_HOLDOUT,"bootstrapReplicates":BOOT,
        "verifiedRule":"positive residual advantage in discovery and holdout, discovery n>=100, holdout n>=25, discovery 95% bootstrap CI entirely >0"},
      "pricingAssumption":"-110 flat is descriptive only; residual advantage is primary. No executable-price claim.",
      "verifiedCount":len(verified),"verified":verified,"allCuts":rows,
      "governance":{"canQualify":False,"autoPromote":False,"closingMarketAsModelInput":False,
        "rule":"VERIFIED is research evidence only until prospective confirmation and operator-approved qualification policy."}}
    (OUT/"report.json").write_text(json.dumps(report,indent=2))
    x.to_csv(OUT/"analysis-rows.csv",index=False)
    print(json.dumps({k:v for k,v in report.items() if k!="allCuts"},indent=2))
if __name__=="__main__": main()
