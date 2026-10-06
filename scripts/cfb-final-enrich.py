#!/usr/bin/env python3
import json, re
from pathlib import Path
import numpy as np
import pandas as pd

BASE=Path("artifacts/cfb-history-v2/cfb_game_training_2004_2026.csv")
CTX=Path("artifacts/cfb-context")
MARKET=Path("artifacts/cfb-history-v3/cfbd_market_lines_all_providers.csv")
LINE_ARCHIVE=Path("artifacts/cfb-line-archive/cfb_line_odds_consensus_2006_2025.csv")
OUT=Path("artifacts/cfb-final"); OUT.mkdir(parents=True,exist_ok=True)

def norm_id(v):
    if pd.isna(v): return None
    try:return str(int(float(v)))
    except Exception:return str(v).strip()

def n(v):
    try:
        x=float(v);return x if np.isfinite(x) else np.nan
    except Exception:return np.nan

def prefix_numeric(row,prefix,exclude=()):
    out={}
    if row is None:return out
    for c,v in row.items():
        if c in exclude:continue
        x=n(v)
        if np.isfinite(x):out[prefix+c]=x
    return out

def latest_week_row(df,season,team_id,target_week,week_col,valid_mask=None):
    if df is None or df.empty:return None
    x=df[(df["season"]==season)&(df["team_id_norm"]==team_id)].copy()
    if valid_mask is not None:x=x[valid_mask.loc[x.index]]
    x=x[pd.to_numeric(x[week_col],errors="coerce")<target_week]
    if x.empty:return None
    x=x.sort_values(week_col)
    return x.iloc[-1]

def exact_row(df,season,team_id):
    if df is None or df.empty:return None
    x=df[(df["season"]==season)&(df["team_id_norm"]==team_id)]
    return None if x.empty else x.iloc[-1]

def market_consensus(path):
    if not path.exists():return pd.DataFrame()
    m=pd.read_csv(path,low_memory=False)
    for c in ["home_spread","total","opening_spread","opening_total","home_moneyline","away_moneyline"]:
        if c in m.columns:m[c]=pd.to_numeric(m[c],errors="coerce")
    rows=[]
    for gid,g in m.groupby("game_id"):
        rows.append({
          "game_id":norm_id(gid),
          "cfbd_provider_count":int(g["provider"].dropna().nunique()) if "provider" in g else 0,
          "cfbd_home_spread_median":g["home_spread"].median() if "home_spread" in g else np.nan,
          "cfbd_total_median":g["total"].median() if "total" in g else np.nan,
          "cfbd_opening_spread_raw_median":g["opening_spread"].median() if "opening_spread" in g else np.nan,
          "cfbd_opening_total_median":g["opening_total"].median() if "opening_total" in g else np.nan,
          "cfbd_home_moneyline_median":g["home_moneyline"].median() if "home_moneyline" in g else np.nan,
          "cfbd_away_moneyline_median":g["away_moneyline"].median() if "away_moneyline" in g else np.nan,
        })
    return pd.DataFrame(rows)

def main():
    games=pd.read_csv(BASE,low_memory=False)
    games["game_id"]=games["game_id"].map(norm_id)
    games["home_id_norm"]=games["home_id"].map(norm_id)
    games["away_id_norm"]=games["away_id"].map(norm_id)
    games["season"]=pd.to_numeric(games["season"],errors="coerce")
    games["week"]=pd.to_numeric(games["week"],errors="coerce")

    ratings=pd.read_parquet(CTX/"cfb_ratings_weekly_history.parquet")
    fpi=pd.read_parquet(CTX/"cfb_fpi_weekly_history.parquet")
    talent=pd.read_parquet(CTX/"cfb_team_talent_history.parquet")
    returning=pd.read_parquet(CTX/"cfb_returning_production_history.parquet")
    recruits=pd.read_parquet(CTX/"cfb_recruits_history.parquet")
    recruiting_proj=pd.read_parquet(CTX/"cfb_recruiting_proj_history.parquet")

    for d in [ratings,fpi,talent,returning,recruits,recruiting_proj]:
        if "team_id" in d.columns:d["team_id_norm"]=d["team_id"].map(norm_id)
        if "season" in d.columns:d["season"]=pd.to_numeric(d["season"],errors="coerce")
    fpi_valid=pd.Series(True,index=fpi.index)
    if "snapshot_is_contemporaneous" in fpi.columns:
        fpi_valid &= fpi["snapshot_is_contemporaneous"].fillna(False).astype(bool)
    if "snapshot_out_of_sequence" in fpi.columns:
        fpi_valid &= ~fpi["snapshot_out_of_sequence"].fillna(False).astype(bool)

    # Recruiting summary by class/team; used as preseason context only.
    recruit_num=[c for c in ["stars","grade"] if c in recruits.columns]
    recruit_aggs={}
    for (season,tid),g in recruits.groupby(["season","team_id_norm"],dropna=True):
        r={"recruit_count":len(g)}
        for c in recruit_num:
            vals=pd.to_numeric(g[c],errors="coerce")
            r["recruit_"+c+"_mean"]=vals.mean()
            r["recruit_"+c+"_sum"]=vals.sum(min_count=1)
        if "stars" in g.columns:
            st=pd.to_numeric(g["stars"],errors="coerce")
            r["blue_chip_recruit_count"]=int((st>=4).sum())
        recruit_aggs[(season,tid)]=r

    context_rows=[]
    exclude_ids={"season","team_id","team_id_norm","fbis_source_year","week","through_week","run_date_time_key","last_updated"}
    for idx,g in games.iterrows():
        season=int(g.season) if np.isfinite(g.season) else None
        week=float(g.week) if np.isfinite(g.week) else 99
        row={"game_id":g.game_id}
        for side in ["home","away"]:
            tid=g[f"{side}_id_norm"]
            rr=latest_week_row(ratings,season,tid,week,"through_week")
            fr=latest_week_row(fpi,season,tid,week,"week",fpi_valid)
            tr=exact_row(talent,season,tid)
            ret=exact_row(returning,season,tid)
            rp=exact_row(recruiting_proj,season,tid)
            ctx={}
            ctx.update(prefix_numeric(rr,"rating_",exclude_ids))
            ctx.update(prefix_numeric(fr,"fpi_",exclude_ids|{"snapshot_is_contemporaneous","snapshot_out_of_sequence"}))
            ctx.update(prefix_numeric(tr,"talent_",exclude_ids))
            ctx.update(prefix_numeric(ret,"returning_",exclude_ids))
            ctx.update(prefix_numeric(rp,"recruiting_proj_",exclude_ids))
            ctx.update(recruit_aggs.get((season,tid),{}))
            for k,v in ctx.items():row[f"{side}_ctx_{k}"]=v
        context_rows.append(row)
    cx=pd.DataFrame(context_rows)
    out=games.merge(cx,on="game_id",how="left")

    # Add home-away differences / additive totals for context only.
    hcols=[c for c in out.columns if c.startswith("home_ctx_")]
    for hc in hcols:
        stem=hc[len("home_ctx_"):];ac="away_ctx_"+stem
        if ac not in out.columns:continue
        hv=pd.to_numeric(out[hc],errors="coerce");av=pd.to_numeric(out[ac],errors="coerce")
        out["diff_ctx_"+stem]=hv-av
        out["sum_ctx_"+stem]=hv+av

    mc=market_consensus(MARKET)
    if not mc.empty:out=out.merge(mc,on="game_id",how="left")
    if LINE_ARCHIVE.exists():
        arc=pd.read_csv(LINE_ARCHIVE,low_memory=False)
        arc["game_id"]=arc["game_id"].map(norm_id)
        out=out.merge(arc,on="game_id",how="left",suffixes=("","_archive"))

    sd_spread=pd.to_numeric(out.get("market_home_spread"),errors="coerce")
    sd_total=pd.to_numeric(out.get("market_total"),errors="coerce")
    available=out.get("market_game_spread_available")
    if available is not None:
        valid=available.fillna(False).astype(bool)
        sd_spread=sd_spread.where(valid)
        sd_total=sd_total.where(valid)
    arc_spread=pd.to_numeric(out.get("sdv_archive_home_spread"),errors="coerce") if "sdv_archive_home_spread" in out else pd.Series(np.nan,index=out.index)
    arc_total=pd.to_numeric(out.get("sdv_archive_total"),errors="coerce") if "sdv_archive_total" in out else pd.Series(np.nan,index=out.index)
    cf_spread=pd.to_numeric(out.get("cfbd_home_spread_median"),errors="coerce") if "cfbd_home_spread_median" in out else pd.Series(np.nan,index=out.index)
    cf_total=pd.to_numeric(out.get("cfbd_total_median"),errors="coerce") if "cfbd_total_median" in out else pd.Series(np.nan,index=out.index)
    out["benchmark_home_spread"]=arc_spread.fillna(cf_spread).fillna(sd_spread)
    out["benchmark_total"]=arc_total.fillna(cf_total).fillna(sd_total)
    out["benchmark_spread_source"]=np.select([arc_spread.notna(),cf_spread.notna(),sd_spread.notna()],["SportsDataverse-multibook","CFBD-provider-median","SportsDataverse-ESPN-valid"],default="missing")
    out["benchmark_total_source"]=np.select([arc_total.notna(),cf_total.notna(),sd_total.notna()],["SportsDataverse-multibook","CFBD-provider-median","SportsDataverse-ESPN-valid"],default="missing")
    overlap=arc_spread.notna()&cf_spread.notna()
    market_crosscheck_n=int(overlap.sum())
    market_crosscheck_mae=float((arc_spread[overlap]-cf_spread[overlap]).abs().mean()) if market_crosscheck_n else None
    market_crosscheck_sign=float((np.sign(arc_spread[overlap])==np.sign(cf_spread[overlap])).mean()) if market_crosscheck_n else None

    out.to_csv(OUT/"cfb_training_full_enriched_2004_2026.csv",index=False)
    out.to_parquet(OUT/"cfb_training_full_enriched_2004_2026.parquet",index=False)

    pregame=[c for c in out.columns if c.startswith(("home_pregame_","away_pregame_","diff_pregame_","sum_pregame_","home_ctx_","away_ctx_","diff_ctx_","sum_ctx_"))]
    market=[c for c in out.columns if c.startswith(("market_","cfbd_","benchmark_"))]
    qa={
      "generatedAt":pd.Timestamp.utcnow().isoformat(),
      "rows":len(out),"duplicateGameIds":int(out.game_id.duplicated().sum()),
      "pregameFeatureColumns":len(pregame),"marketColumns":len(market),
      "gamesWithBenchmarkSpread":int(out.benchmark_home_spread.notna().sum()),
      "gamesWithBenchmarkTotal":int(out.benchmark_total.notna().sum()),
      "marketCrosscheckN":market_crosscheck_n,
      "marketCrosscheckMae":market_crosscheck_mae,
      "marketCrosscheckSignAgreement":market_crosscheck_sign,
      "benchmarkSpreadSources":{str(k):int(v) for k,v in out.benchmark_spread_source.value_counts(dropna=False).to_dict().items()},
      "gamesWithWeeklyRatings":int(out[[c for c in out.columns if c.startswith("home_ctx_rating_")]].notna().any(axis=1).sum()),
      "gamesWithFpi":int(out[[c for c in out.columns if c.startswith("home_ctx_fpi_")]].notna().any(axis=1).sum()),
      "gamesWithTalent":int(out[[c for c in out.columns if c.startswith("home_ctx_talent_")]].notna().any(axis=1).sum()),
      "gamesWithReturning":int(out[[c for c in out.columns if c.startswith("home_ctx_returning_")]].notna().any(axis=1).sum()),
      "temporalIntegrity":"Game rolling features use shift(1). Weekly ratings/FPI use strictly prior week. FPI requires contemporaneous and not out-of-sequence when flags exist. Talent/returning/recruiting are season/preseason context. Market columns are excluded from independent model features.",
    }
    (OUT/"cfb_final_qa.json").write_text(json.dumps(qa,indent=2))
    print(json.dumps(qa,indent=2))
    if qa["duplicateGameIds"]!=0 or qa["pregameFeatureColumns"]<100:
        raise RuntimeError(f"enriched CFB dataset failed QA: {qa}")
    if market_crosscheck_n>=500 and (market_crosscheck_sign is None or market_crosscheck_sign<0.95):
        raise RuntimeError(f"CFB market sign crosscheck failed: {qa}")
    if market_crosscheck_n>=500 and (market_crosscheck_mae is None or market_crosscheck_mae>3.0):
        raise RuntimeError(f"CFB market source disagreement failed QA: {qa}")

if __name__=="__main__":main()
