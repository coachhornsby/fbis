#!/usr/bin/env python3
"""
Repair/complete the CFB historical market benchmark from a successful v3 checkpoint.

Inputs:
- successful v3 checkpoint artifact (games/features + OOS predictions)
- SportsDataverse cfb_line_odds multi-book archive
- CFBD provider-level line archive

No football feature is rebuilt here. This script only repairs market orientation,
constructs the canonical benchmark, cross-checks sources, and recomputes market
comparison metrics. Market data remains evaluation-only.
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd

CHECKPOINT=Path("checkpoint")
FINAL=CHECKPOINT/"cfb-final"/"cfb_training_full_enriched_2004_2026.csv"
OOS=CHECKPOINT/"cfb-final"/"model"/"cfb_v3_oos_predictions.csv"
CFBD=CHECKPOINT/"cfb-history-v3"/"cfbd_market_lines_all_providers.csv"
SDV=Path("artifacts/cfb-line-archive/cfb_line_odds_consensus_2006_2025.csv")
OUT=Path("artifacts/cfb-market-final"); OUT.mkdir(parents=True,exist_ok=True)

def norm_id(v):
    if pd.isna(v): return None
    try:return str(int(float(v)))
    except Exception:return str(v).strip()

def metrics(a,pm,pt):
    ok=np.isfinite(pm)&np.isfinite(pt)&np.isfinite(a.actual_margin)&np.isfinite(a.actual_total)
    aa=a.loc[ok];m=np.asarray(pm)[ok];t=np.asarray(pt)[ok]
    return {
      "n":int(len(aa)),
      "marginMae":float(np.mean(np.abs(aa.actual_margin.to_numpy()-m))),
      "totalMae":float(np.mean(np.abs(aa.actual_total.to_numpy()-t))),
      "winnerAccuracy":float(np.mean((aa.actual_margin.to_numpy()>0)==(m>0))),
    }

def main():
    for p in [FINAL,OOS,CFBD,SDV]:
        if not p.exists(): raise RuntimeError(f"missing required input: {p}")

    games=pd.read_csv(FINAL,low_memory=False)
    games["game_id"]=games["game_id"].map(norm_id)
    cf=pd.read_csv(CFBD,low_memory=False)
    cf["game_id"]=cf["game_id"].map(norm_id)
    # CFBD spread is already home-team perspective. Earlier favorite-text flipping was wrong.
    cf["home_spread_corrected"]=pd.to_numeric(cf["raw_spread"],errors="coerce")
    for c in ["total","opening_spread","opening_total","home_moneyline","away_moneyline"]:
        cf[c]=pd.to_numeric(cf[c],errors="coerce")
    cf_cons=(cf.groupby("game_id",as_index=False)
        .agg(cfbd_provider_count=("provider","nunique"),
             cfbd_home_spread=("home_spread_corrected","median"),
             cfbd_total=("total","median"),
             cfbd_opening_home_spread=("opening_spread","median"),
             cfbd_opening_total=("opening_total","median"),
             cfbd_home_ml=("home_moneyline","median"),
             cfbd_away_ml=("away_moneyline","median")))

    sdv=pd.read_csv(SDV,low_memory=False)
    sdv["game_id"]=sdv["game_id"].map(norm_id)
    games=games.merge(cf_cons,on="game_id",how="left").merge(sdv,on="game_id",how="left")

    espn_sp=pd.to_numeric(games.get("market_home_spread"),errors="coerce")
    espn_tot=pd.to_numeric(games.get("market_total"),errors="coerce")
    if "market_game_spread_available" in games:
        valid=games["market_game_spread_available"].fillna(False).astype(bool)
        espn_sp=espn_sp.where(valid); espn_tot=espn_tot.where(valid)

    arc_sp=pd.to_numeric(games.get("sdv_archive_home_spread"),errors="coerce")
    arc_tot=pd.to_numeric(games.get("sdv_archive_total"),errors="coerce")
    cf_sp=pd.to_numeric(games.get("cfbd_home_spread"),errors="coerce")
    cf_tot=pd.to_numeric(games.get("cfbd_total"),errors="coerce")

    games["benchmark_home_spread"]=arc_sp.fillna(cf_sp).fillna(espn_sp)
    games["benchmark_total"]=arc_tot.fillna(cf_tot).fillna(espn_tot)
    games["benchmark_spread_source"]=np.select(
      [arc_sp.notna(),cf_sp.notna(),espn_sp.notna()],
      ["SportsDataverse-multibook","CFBD-provider-median","SportsDataverse-ESPN-valid"],
      default="missing")
    games["benchmark_total_source"]=np.select(
      [arc_tot.notna(),cf_tot.notna(),espn_tot.notna()],
      ["SportsDataverse-multibook","CFBD-provider-median","SportsDataverse-ESPN-valid"],
      default="missing")

    overlap=arc_sp.notna()&cf_sp.notna()
    n=int(overlap.sum())
    mae=float((arc_sp[overlap]-cf_sp[overlap]).abs().mean()) if n else None
    sign=float((np.sign(arc_sp[overlap])==np.sign(cf_sp[overlap])).mean()) if n else None

    market_cols=[
      "game_id","season","week","game_date","home_team","away_team","home_score","away_score",
      "home_margin","final_total","benchmark_home_spread","benchmark_total",
      "benchmark_spread_source","benchmark_total_source","cfbd_provider_count",
      "cfbd_opening_home_spread","cfbd_opening_total","cfbd_home_ml","cfbd_away_ml",
      "sdv_archive_home_spread","sdv_archive_total","sdv_archive_open_home_spread",
      "sdv_archive_open_total","sdv_archive_spread_books","sdv_archive_total_books"
    ]
    market_cols=[c for c in market_cols if c in games.columns]
    games[market_cols].to_csv(OUT/"cfb_market_benchmark_2004_2026.csv",index=False)

    oos=pd.read_csv(OOS,low_memory=False)
    oos["game_id"]=oos["game_id"].map(norm_id)
    m=oos.merge(games[["game_id","benchmark_home_spread","benchmark_total","benchmark_spread_source","benchmark_total_source"]],on="game_id",how="left")
    m["market_margin"]=-pd.to_numeric(m.benchmark_home_spread,errors="coerce")
    m["market_total"]=pd.to_numeric(m.benchmark_total,errors="coerce")
    paired=m[m.market_margin.notna()&m.market_total.notna()].copy()

    model=metrics(paired,paired.model_margin.to_numpy(),paired.model_total.to_numpy())
    market=metrics(paired,paired.market_margin.to_numpy(),paired.market_total.to_numpy())

    season_rows=[]
    for season,g in m.groupby("season"):
        p=g[g.market_margin.notna()&g.market_total.notna()]
        if not len(p): continue
        season_rows.append({
          "season":int(season),"n":int(len(p)),
          "modelMarginMae":metrics(p,p.model_margin.to_numpy(),p.model_total.to_numpy())["marginMae"],
          "modelTotalMae":metrics(p,p.model_margin.to_numpy(),p.model_total.to_numpy())["totalMae"],
          "modelWinnerAccuracy":metrics(p,p.model_margin.to_numpy(),p.model_total.to_numpy())["winnerAccuracy"],
          "marketMarginMae":metrics(p,p.market_margin.to_numpy(),p.market_total.to_numpy())["marginMae"],
          "marketTotalMae":metrics(p,p.market_margin.to_numpy(),p.market_total.to_numpy())["totalMae"],
          "marketWinnerAccuracy":metrics(p,p.market_margin.to_numpy(),p.market_total.to_numpy())["winnerAccuracy"],
        })
    pd.DataFrame(season_rows).to_csv(OUT/"cfb_market_model_by_season.csv",index=False)
    m.to_csv(OUT/"cfb_v3_oos_predictions_with_canonical_market.csv",index=False)

    qa={
      "generatedAt":pd.Timestamp.utcnow().isoformat(),
      "gameRows":int(len(games)),
      "gamesWithBenchmarkSpread":int(games.benchmark_home_spread.notna().sum()),
      "gamesWithBenchmarkTotal":int(games.benchmark_total.notna().sum()),
      "spreadCoveragePct":float(games.benchmark_home_spread.notna().mean()*100),
      "totalCoveragePct":float(games.benchmark_total.notna().mean()*100),
      "benchmarkSpreadSources":{str(k):int(v) for k,v in games.benchmark_spread_source.value_counts(dropna=False).to_dict().items()},
      "marketCrosscheckN":n,
      "marketCrosscheckMae":mae,
      "marketCrosscheckSignAgreement":sign,
      "oosMarketPairedN":int(len(paired)),
      "pairedModel":model,
      "market":market,
      "deltasModelMinusMarket":{
        "marginMae":model["marginMae"]-market["marginMae"],
        "totalMae":model["totalMae"]-market["totalMae"],
        "winnerAccuracy":model["winnerAccuracy"]-market["winnerAccuracy"],
      },
      "governance":"Market benchmark only. No market field enters independent CFB model features or wager authorization."
    }
    (OUT/"cfb_market_final_qa.json").write_text(json.dumps(qa,indent=2))
    print(json.dumps(qa,indent=2))

    if n>=500 and (sign is None or sign<0.95):
        raise RuntimeError(f"market sign agreement failed: {qa}")
    if n>=500 and (mae is None or mae>3.0):
        raise RuntimeError(f"market cross-source MAE failed: {qa}")
    if qa["gamesWithBenchmarkSpread"]<15000 or qa["gamesWithBenchmarkTotal"]<15000:
        raise RuntimeError(f"market coverage unexpectedly low: {qa}")

if __name__=="__main__": main()
