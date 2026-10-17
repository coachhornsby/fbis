#!/usr/bin/env python3
import json, math
from pathlib import Path
import numpy as np
import pandas as pd

CFBD=Path("artifacts/cfb-history/cfb_game_training_full_history.csv")
CFBD_LINES=Path("artifacts/cfb-history/cfb_market_lines_all_providers.csv")
ESPN=Path("artifacts/cfb-history-v2/cfb_game_training_2004_2026.csv")
ESPN_BETS=Path("artifacts/cfb-history-v2/cfb_betting_resolved_2004_2026.csv")\nLEGACY=Path("artifacts/cfb-legacy-espn/cfb_legacy_espn_lines_2002_2012.csv")
OUT=Path("artifacts/cfb-master"); OUT.mkdir(parents=True,exist_ok=True)

def norm_id(v):
    if pd.isna(v): return None
    try: return str(int(float(v)))
    except Exception: return str(v).strip()

def clean_num(s):
    return pd.to_numeric(s,errors="coerce")

def valid_spread(s):
    x=clean_num(s)
    return x.where(x.abs()<=80)

def valid_total(s):
    x=clean_num(s)
    return x.where((x>=10)&(x<=120))

def main():
    cf=pd.read_csv(CFBD,low_memory=False)
    ep=pd.read_csv(ESPN,low_memory=False)
    bets=pd.read_csv(ESPN_BETS,low_memory=False)
    raw_lines=pd.read_csv(CFBD_LINES,low_memory=False)\n    legacy=pd.read_csv(LEGACY,low_memory=False) if LEGACY.exists() else pd.DataFrame(columns=["game_id","legacy_espn_home_spread","legacy_espn_total"])

    for d in [cf,ep,bets,raw_lines,legacy]:
        d["game_id"]=d["game_id"].map(norm_id)

    # SportsDataverse resolved betting has explicit availability; default rows are placeholders.
    if "game_spread_available" in bets:
        bets=bets[bets["game_spread_available"].fillna(False).astype(bool)].copy()
    bets["espn_home_spread"]=valid_spread(bets.get("home_team_spread"))
    bets["espn_total"]=valid_total(bets.get("over_under"))
    bets=bets[["game_id","espn_home_spread","espn_total","odds_source"]].drop_duplicates("game_id")

    ep_keep=[c for c in [
        "game_id","home_pregame_rank","away_pregame_rank","diff_pregame_rank","sum_pregame_rank",
        "home_pregame_rest_days","away_pregame_rest_days","diff_pregame_rest_days","sum_pregame_rest_days",
        "home_primary_qb","away_primary_qb"
    ] if c in ep.columns]
    enrich=ep[ep_keep].drop_duplicates("game_id").merge(bets,on="game_id",how="outer")

    m=cf.merge(enrich,on="game_id",how="left").merge(legacy[["game_id","legacy_espn_home_spread","legacy_espn_total"]].drop_duplicates("game_id"),on="game_id",how="left")
    m["cfbd_home_spread"]=valid_spread(m.get("market_home_spread_median"))
    m["cfbd_total"]=valid_total(m.get("market_total_median"))
    m["market_home_spread"]=m["cfbd_home_spread"].combine_first(m["espn_home_spread"])
    m["market_total"]=m["cfbd_total"].combine_first(m["espn_total"])
    m["market_spread_source"]=np.select(
        [m["cfbd_home_spread"].notna(),m["espn_home_spread"].notna()],
        ["CFBD_PROVIDER_MEDIAN","SPORTSDATAVERSE_ESPN"],
        default="MISSING"
    )
    m["market_total_source"]=np.select(
        [m["cfbd_total"].notna(),m["espn_total"].notna()],
        ["CFBD_PROVIDER_MEDIAN","SPORTSDATAVERSE_ESPN"],
        default="MISSING"
    )
    m["spread_cross_source_abs_diff"]=(m["cfbd_home_spread"]-m["espn_home_spread"]).abs()
    m["total_cross_source_abs_diff"]=(m["cfbd_total"]-m["espn_total"]).abs()
    m["market_implied_home_margin"]=-m["market_home_spread"]
    m["home_ats_margin"]=m["home_margin"]+m["market_home_spread"]
    m["total_margin_vs_market"]=m["final_total"]-m["market_total"]

    # Keep missing opening/moneyline values missing; zero ML is never a valid price.
    for c in ["market_open_home_spread_median","market_open_total_median"]:
        if c in m.columns:
            if "total" in c: m[c]=valid_total(m[c])
            else: m[c]=valid_spread(m[c])
    for c in ["market_home_ml_median","market_away_ml_median"]:
        if c in m.columns:
            x=clean_num(m[c]); m[c]=x.where(x!=0)

    # Archive ESPN schedule rows that do not resolve to the CFBD game universe.
    unmatched=ep[~ep.game_id.isin(set(cf.game_id))].copy()
    unmatched.to_csv(OUT/"cfb_espn_unmatched_games.csv",index=False)

    # Provider-level CFBD market file, sanitized.
    raw_lines["home_spread"]=valid_spread(raw_lines["home_spread"])
    raw_lines["total"]=valid_total(raw_lines["total"])
    raw_lines["opening_home_spread"]=valid_spread(raw_lines["opening_home_spread"])
    raw_lines["opening_total"]=valid_total(raw_lines["opening_total"])
    for c in ["home_moneyline","away_moneyline"]:
        x=clean_num(raw_lines[c]); raw_lines[c]=x.where(x!=0)
    raw_lines.to_csv(OUT/"cfb_market_lines_all_providers_clean.csv",index=False)

    m=m.sort_values(["season","week","start_date","game_id"]).reset_index(drop=True)
    m.to_csv(OUT/"cfb_master_training_2000_2026.csv",index=False)

    finals=m[m.home_score.notna()&m.away_score.notna()].copy()
    fbs=finals[finals.training_eligible.eq(1)] if "training_eligible" in finals else finals
    both_sp=m.dropna(subset=["cfbd_home_spread","espn_home_spread"])
    both_tot=m.dropna(subset=["cfbd_total","espn_total"])
    disagreements=m[
        ((m["spread_cross_source_abs_diff"]>3)&m["spread_cross_source_abs_diff"].notna()) |
        ((m["total_cross_source_abs_diff"]>5)&m["total_cross_source_abs_diff"].notna())
    ].copy()
    disagreements.to_csv(OUT/"cfb_market_cross_source_disagreements.csv",index=False)

    by_season=[]
    for season,g in m.groupby("season"):
        by_season.append({
            "season":int(season),"games":int(len(g)),
            "spreadGames":int(g.market_home_spread.notna().sum()),
            "totalGames":int(g.market_total.notna().sum()),
            "cfbdSpreadGames":int(g.cfbd_home_spread.notna().sum()),
            "espnSpreadGames":int(g.espn_home_spread.notna().sum()),
        })
    qa={
        "generatedAt":pd.Timestamp.utcnow().isoformat(),
        "gameRows":int(len(m)),"finalGames":int(len(finals)),"trainingEligible":int(len(fbs)),
        "duplicateGameIds":int(m.game_id.duplicated().sum()),
        "firstSeason":int(m.season.min()),"lastSeason":int(m.season.max()),
        "gamesWithCanonicalSpread":int(m.market_home_spread.notna().sum()),
        "gamesWithCanonicalTotal":int(m.market_total.notna().sum()),
        "spreadCoverageAllPct":round(float(m.market_home_spread.notna().mean()*100),3),
        "totalCoverageAllPct":round(float(m.market_total.notna().mean()*100),3),
        "spreadCoverageTrainingPct":round(float(fbs.market_home_spread.notna().mean()*100),3) if len(fbs) else 0,
        "totalCoverageTrainingPct":round(float(fbs.market_total.notna().mean()*100),3) if len(fbs) else 0,
        "cfbdProviderLineRows":int(len(raw_lines)),
        "espnResolvedValidSpreadRows":int(bets.espn_home_spread.notna().sum()),
        "espnResolvedValidTotalRows":int(bets.espn_total.notna().sum()),\n        "legacyEspnValidSpreadRows":int(pd.to_numeric(legacy.get("legacy_espn_home_spread"),errors="coerce").notna().sum()) if len(legacy) else 0,\n        "legacyEspnValidTotalRows":int(pd.to_numeric(legacy.get("legacy_espn_total"),errors="coerce").notna().sum()) if len(legacy) else 0,
        "crossSourceSpreadN":int(len(both_sp)),
        "crossSourceSpreadMae":float(both_sp.spread_cross_source_abs_diff.mean()) if len(both_sp) else None,
        "crossSourceTotalN":int(len(both_tot)),
        "crossSourceTotalMae":float(both_tot.total_cross_source_abs_diff.mean()) if len(both_tot) else None,
        "espnUnmatchedScheduleRows":int(len(unmatched)),
        "crossSourceMaterialDisagreements":int(len(disagreements)),
        "post2013TrainingSpreadCoveragePct":round(float(fbs[fbs.season>=2013].market_home_spread.notna().mean()*100),3) if len(fbs[fbs.season>=2013]) else 0,
        "post2013TrainingTotalCoveragePct":round(float(fbs[fbs.season>=2013].market_total.notna().mean()*100),3) if len(fbs[fbs.season>=2013]) else 0,
        "bySeason":by_season,
        "temporalIntegrity":"Football features remain pregame-only. CFBD rolling features use only prior chronological games; CORE requires throughWeek < target week; prior ratings use prior-season freezes; Elo uses prior week. ESPN enrichment is rank/rest/QB identity plus market benchmark only.",
        "marketPolicy":"Independent model features never consume market data. Canonical benchmark prefers sanitized CFBD provider median, then valid SportsDataverse/ESPN resolved line. All CFBD provider records are retained separately.",
    }
    (OUT/"cfb_master_qa.json").write_text(json.dumps(qa,indent=2))
    if qa["duplicateGameIds"]!=0: raise RuntimeError("duplicate canonical game IDs")
    if qa["gamesWithCanonicalSpread"]==0 or qa["gamesWithCanonicalTotal"]==0: raise RuntimeError("market benchmark unexpectedly empty")
    if qa["firstSeason"]!=2000 or qa["lastSeason"]!=2026: raise RuntimeError("historical season range incomplete")
    if qa["post2013TrainingSpreadCoveragePct"]<95 or qa["post2013TrainingTotalCoveragePct"]<95:
        raise RuntimeError("post-2013 betting coverage below 95%; refusing incomplete market benchmark")
    print(json.dumps(qa,indent=2))

if __name__=="__main__": main()
