#!/usr/bin/env python3
"""
Build a lossless + per-game consensus copy of the published SportsDataverse
cfb_line_odds multi-book archive. This is the durable 2006-2025 historical
betting source used by the upstream CFB model-training project.

Market data is benchmark/evaluation only.
"""
from __future__ import annotations
import json, os, re
from pathlib import Path
import numpy as np
import pandas as pd

URL=os.getenv(
    "CFB_LINE_ODDS_URL",
    "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/betting/parquet/cfb_line_odds.parquet",
)
OUT=Path("artifacts/cfb-line-archive"); OUT.mkdir(parents=True,exist_ok=True)

def norm_name(v):
    s=str(v or "").strip().lower().replace("&"," and ").replace(".","")
    s=re.sub(r"[^a-z0-9 ]+"," ",s)
    s=re.sub(r"\s+"," ",s).strip()
    aliases={
      "texas christian":"tcu","louisiana state":"lsu","southern methodist":"smu",
      "central florida":"ucf","brigham young":"byu","nevada las vegas":"unlv",
      "texas el paso":"utep","north carolina state":"nc state","pittsburgh":"pitt",
    }
    return aliases.get(s,s)

def game_id(v):
    if pd.isna(v): return None
    try:return str(int(float(v)))
    except Exception:return str(v).strip()

def main():
    print(f"reading {URL}",flush=True)
    d=pd.read_parquet(URL)
    d.columns=[str(c) for c in d.columns]
    if "game_id" not in d.columns:
        raise RuntimeError("cfb_line_odds missing game_id")
    d["game_id_norm"]=d["game_id"].map(game_id)
    d=d[d.game_id_norm.notna()].copy()
    if "season" in d.columns:d["season"]=pd.to_numeric(d["season"],errors="coerce")
    d.to_parquet(OUT/"cfb_line_odds_lossless.parquet",index=False)

    spread=d[(d.market_type.astype(str)=="spread") & pd.to_numeric(d.lines,errors="coerce").notna()].copy()
    parts=spread["game_desc"].astype(str).str.split("@",n=1,expand=True)
    spread["_away_name"]=parts[0].map(norm_name)
    spread["_home_name"]=parts[1].map(norm_name)
    spread["_abbr"]=spread["abbr"].astype(str)

    # Reproduce upstream crosswalk-free side resolution: an abbreviation's own
    # canonical name is the modal name across all away/home co-occurrences.
    a=spread[["_abbr","_away_name"]].rename(columns={"_away_name":"_name"})
    h=spread[["_abbr","_home_name"]].rename(columns={"_home_name":"_name"})
    counts=pd.concat([a,h],ignore_index=True).groupby(["_abbr","_name"]).size().reset_index(name="n")
    counts=counts.sort_values(["_abbr","n","_name"],ascending=[True,False,True])
    amap=counts.drop_duplicates("_abbr").set_index("_abbr")["_name"].to_dict()
    spread["_team_name"]=spread["_abbr"].map(amap)
    spread["_is_home"]=spread["_team_name"].eq(spread["_home_name"])
    spread["line_num"]=pd.to_numeric(spread["lines"],errors="coerce")
    spread["open_num"]=pd.to_numeric(spread.get("opening_lines"),errors="coerce")

    home_spread=spread[spread._is_home].groupby("game_id_norm").agg(
        sdv_archive_home_spread=("line_num","median"),
        sdv_archive_open_home_spread=("open_num","median"),
        sdv_archive_spread_books=("book","nunique"),
    ).reset_index()

    total=d[(d.market_type.astype(str)=="total") & pd.to_numeric(d.lines,errors="coerce").notna()].copy()
    total["line_num"]=pd.to_numeric(total["lines"],errors="coerce")
    total["open_num"]=pd.to_numeric(total.get("opening_lines"),errors="coerce")
    totals=total.groupby("game_id_norm").agg(
        sdv_archive_total=("line_num","median"),
        sdv_archive_open_total=("open_num","median"),
        sdv_archive_total_books=("book","nunique"),
    ).reset_index()

    ml=d[(d.market_type.astype(str)=="money_line") & pd.to_numeric(d.odds,errors="coerce").notna()].copy()
    if len(ml):
        mp=ml["game_desc"].astype(str).str.split("@",n=1,expand=True)
        ml["_away_name"]=mp[0].map(norm_name);ml["_home_name"]=mp[1].map(norm_name);ml["_abbr"]=ml["abbr"].astype(str)
        ml["_team_name"]=ml["_abbr"].map(amap);ml["_is_home"]=ml["_team_name"].eq(ml["_home_name"])
        ml["odds_num"]=pd.to_numeric(ml.odds,errors="coerce")
        hm=ml[ml._is_home].groupby("game_id_norm").agg(sdv_archive_home_ml=("odds_num","median")).reset_index()
        am=ml[~ml._is_home].groupby("game_id_norm").agg(sdv_archive_away_ml=("odds_num","median")).reset_index()
    else:
        hm=pd.DataFrame(columns=["game_id_norm","sdv_archive_home_ml"]);am=pd.DataFrame(columns=["game_id_norm","sdv_archive_away_ml"])

    c=home_spread.merge(totals,on="game_id_norm",how="outer").merge(hm,on="game_id_norm",how="outer").merge(am,on="game_id_norm",how="outer")
    season_map=d[["game_id_norm","season"]].dropna().drop_duplicates("game_id_norm")
    c=c.merge(season_map,on="game_id_norm",how="left").rename(columns={"game_id_norm":"game_id"})
    c.to_csv(OUT/"cfb_line_odds_consensus_2006_2025.csv",index=False)
    c.to_parquet(OUT/"cfb_line_odds_consensus_2006_2025.parquet",index=False)

    q={
      "generatedAt":pd.Timestamp.utcnow().isoformat(),
      "source":URL,
      "losslessRows":int(len(d)),
      "seasons":[int(d.season.min()),int(d.season.max())] if "season" in d and d.season.notna().any() else None,
      "gamesWithSpread":int(c.sdv_archive_home_spread.notna().sum()),
      "gamesWithTotal":int(c.sdv_archive_total.notna().sum()),
      "gamesWithOpeningSpread":int(c.sdv_archive_open_home_spread.notna().sum()),
      "gamesWithOpeningTotal":int(c.sdv_archive_open_total.notna().sum()),
      "books":sorted([str(x) for x in d.get("book",pd.Series(dtype=str)).dropna().unique()]),
      "spreadConvention":"Standard home-team market line: negative means home favorite, positive means home underdog.",
      "policy":"Lossless archive retained. Per-game benchmark is median home-side line/total across available books. Market data never enters independent CFB model features."
    }
    (OUT/"cfb_line_odds_qa.json").write_text(json.dumps(q,indent=2))
    print(json.dumps(q,indent=2))

if __name__=="__main__":main()
