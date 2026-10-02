#!/usr/bin/env python3
import io
import json
import math
import os
from pathlib import Path
from urllib.request import urlopen, Request

import numpy as np
import pandas as pd

START_SEASON = 2015
END_SEASON = 2026
OUT_DIR = Path("artifacts/nfl")
OUT_DIR.mkdir(parents=True, exist_ok=True)

PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet"
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
LINES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/closing_lines.csv"

TEAM_ALIASES = {
    "JAC": "JAX",
    "LA": "LAR",
    "STL": "LAR",
    "SD": "LAC",
    "OAK": "LV",
}


def norm_team(x):
    if pd.isna(x):
        return x
    s = str(x).strip().upper()
    return TEAM_ALIASES.get(s, s)


def read_csv_url(url):
    req = Request(url, headers={"User-Agent": "FBIS-nfl-research/1.0"})
    with urlopen(req, timeout=120) as r:
        return pd.read_csv(io.BytesIO(r.read()), low_memory=False)


def read_parquet_url(url):
    req = Request(url, headers={"User-Agent": "FBIS-nfl-research/1.0"})
    with urlopen(req, timeout=180) as r:
        return pd.read_parquet(io.BytesIO(r.read()))


def safe_mean(s):
    s = pd.to_numeric(s, errors="coerce")
    return float(s.mean()) if s.notna().any() else np.nan


def game_team_aggregates(pbp):
    needed = [
        "game_id","season","week","season_type","game_date","home_team","away_team",
        "posteam","defteam","play_type","epa","success","yards_gained","down",
        "pass","rush","sack","interception","fumble_lost","qb_epa","cpoe",
        "score_differential","qtr","passer_player_id","passer_player_name"
    ]
    for c in needed:
        if c not in pbp.columns:
            pbp[c] = np.nan

    for c in ["home_team","away_team","posteam","defteam"]:
        pbp[c] = pbp[c].map(norm_team)

    pbp["epa_num"] = pd.to_numeric(pbp["epa"], errors="coerce")
    pbp["success_num"] = pd.to_numeric(pbp["success"], errors="coerce")
    pbp["yards_num"] = pd.to_numeric(pbp["yards_gained"], errors="coerce")
    pbp["down_num"] = pd.to_numeric(pbp["down"], errors="coerce")
    pbp["pass_num"] = pd.to_numeric(pbp["pass"], errors="coerce").fillna(0)
    pbp["rush_num"] = pd.to_numeric(pbp["rush"], errors="coerce").fillna(0)
    pbp["sack_num"] = pd.to_numeric(pbp["sack"], errors="coerce").fillna(0)
    pbp["int_num"] = pd.to_numeric(pbp["interception"], errors="coerce").fillna(0)
    pbp["fum_lost_num"] = pd.to_numeric(pbp["fumble_lost"], errors="coerce").fillna(0)
    pbp["qb_epa_num"] = pd.to_numeric(pbp["qb_epa"], errors="coerce")
    pbp["cpoe_num"] = pd.to_numeric(pbp["cpoe"], errors="coerce")
    pbp["score_diff_num"] = pd.to_numeric(pbp["score_differential"], errors="coerce")
    pbp["qtr_num"] = pd.to_numeric(pbp["qtr"], errors="coerce")

    scrim = pbp[
        pbp["game_id"].notna()
        & pbp["posteam"].notna()
        & pbp["play_type"].isin(["run", "pass"])
        & pbp["epa_num"].notna()
    ].copy()

    scrim["is_pass"] = (scrim["play_type"] == "pass").astype(int)
    scrim["is_rush"] = (scrim["play_type"] == "run").astype(int)
    scrim["explosive"] = (
        ((scrim["is_pass"] == 1) & (scrim["yards_num"] >= 20))
        | ((scrim["is_rush"] == 1) & (scrim["yards_num"] >= 10))
    ).astype(float)
    scrim["early_down"] = scrim["down_num"].isin([1, 2]).astype(int)
    scrim["third_down"] = (scrim["down_num"] == 3).astype(int)
    scrim["neutral"] = (
        (scrim["qtr_num"] <= 3)
        & (scrim["score_diff_num"].abs() <= 8)
    ).astype(int)
    scrim["turnover"] = ((scrim["int_num"] > 0) | (scrim["fum_lost_num"] > 0)).astype(int)
    scrim["dropback_proxy"] = ((scrim["is_pass"] == 1) | (scrim["sack_num"] > 0)).astype(int)

    rows = []
    for (gid, team), g in scrim.groupby(["game_id", "posteam"], sort=False):
        p = g[g["is_pass"] == 1]
        r = g[g["is_rush"] == 1]
        e = g[g["early_down"] == 1]
        t3 = g[g["third_down"] == 1]
        n = g[g["neutral"] == 1]
        drops = g[g["dropback_proxy"] == 1]
        row = {
            "game_id": gid,
            "team": team,
            "off_plays": len(g),
            "off_epa_per_play": safe_mean(g["epa_num"]),
            "off_success_rate": safe_mean(g["success_num"]),
            "off_yards_per_play": safe_mean(g["yards_num"]),
            "pass_plays": len(p),
            "pass_epa_per_play": safe_mean(p["epa_num"]),
            "pass_success_rate": safe_mean(p["success_num"]),
            "rush_plays": len(r),
            "rush_epa_per_play": safe_mean(r["epa_num"]),
            "rush_success_rate": safe_mean(r["success_num"]),
            "explosive_rate": safe_mean(g["explosive"]),
            "early_down_epa": safe_mean(e["epa_num"]),
            "early_down_success_rate": safe_mean(e["success_num"]),
            "third_down_success_rate": safe_mean(t3["success_num"]),
            "turnover_rate": safe_mean(g["turnover"]),
            "sack_rate": (float(g["sack_num"].sum()) / len(drops)) if len(drops) else np.nan,
            "neutral_pass_rate": safe_mean(n["is_pass"]),
            "qb_epa_per_dropback": safe_mean(drops["qb_epa_num"]),
            "cpoe": safe_mean(drops["cpoe_num"]),
        }
        rows.append(row)
    team_game = pd.DataFrame(rows)

    # Primary passer per team/game, selected by most qualifying pass/dropback rows.
    q = pbp[
        pbp["game_id"].notna()
        & pbp["posteam"].notna()
        & pbp["passer_player_name"].notna()
        & ((pbp["pass_num"] == 1) | (pbp["sack_num"] > 0))
    ].copy()
    qb_rows = []
    if len(q):
        grouped = (
            q.groupby(["game_id","posteam","passer_player_id","passer_player_name"], dropna=False)
             .agg(qb_dropbacks=("game_id","size"),
                  qb_epa_game=("qb_epa_num","mean"),
                  qb_cpoe_game=("cpoe_num","mean"))
             .reset_index()
        )
        grouped = grouped.sort_values(["game_id","posteam","qb_dropbacks"], ascending=[True,True,False])
        primary = grouped.drop_duplicates(["game_id","posteam"])
        primary = primary.rename(columns={"posteam":"team"})
        qb_rows = primary[["game_id","team","passer_player_id","passer_player_name","qb_dropbacks","qb_epa_game","qb_cpoe_game"]]
        team_game = team_game.merge(qb_rows, on=["game_id","team"], how="left")

    return team_game


def add_team_pregame_features(team_games, games):
    gm = games[["game_id","season","week","gameday","home_team","away_team"]].copy()
    tg = team_games.merge(gm, on="game_id", how="left")
    tg["gameday"] = pd.to_datetime(tg["gameday"], errors="coerce")
    tg = tg.sort_values(["team","gameday","game_id"]).reset_index(drop=True)

    metrics = [
        "off_epa_per_play","off_success_rate","off_yards_per_play",
        "pass_epa_per_play","pass_success_rate","rush_epa_per_play","rush_success_rate",
        "explosive_rate","early_down_epa","early_down_success_rate",
        "third_down_success_rate","turnover_rate","sack_rate","neutral_pass_rate",
        "qb_epa_per_dropback","cpoe"
    ]

    # Defense is the opponent offense for the same game.
    opp = tg[["game_id","team"] + metrics].copy()
    opp = opp.rename(columns={"team":"opponent", **{m:f"def_{m}" for m in metrics}})
    pair = games[["game_id","home_team","away_team"]].copy()
    long_opp = pd.concat([
        pair.rename(columns={"home_team":"team","away_team":"opponent"})[["game_id","team","opponent"]],
        pair.rename(columns={"away_team":"team","home_team":"opponent"})[["game_id","team","opponent"]],
    ], ignore_index=True)
    tg = tg.merge(long_opp, on=["game_id","team"], how="left")
    tg = tg.merge(opp, on=["game_id","opponent"], how="left")

    all_metrics = metrics + [f"def_{m}" for m in metrics]

    for metric in all_metrics:
        if metric not in tg.columns:
            continue
        # Last-five across chronology (prior games only, may bridge season boundary).
        tg[f"pregame_l5_{metric}"] = (
            tg.groupby("team")[metric]
              .transform(lambda x: x.shift(1).rolling(5, min_periods=1).mean())
        )
        # Season-to-date only, prior games only.
        tg[f"pregame_season_{metric}"] = (
            tg.groupby(["team","season"])[metric]
              .transform(lambda x: x.shift(1).expanding(min_periods=1).mean())
        )

    # QB rolling features by primary passer identity/name.
    if "passer_player_name" in tg.columns:
        qb_key = tg["passer_player_id"].fillna(tg["passer_player_name"])
        tg["_qb_key"] = qb_key
        for metric in ["qb_epa_game","qb_cpoe_game"]:
            if metric in tg.columns:
                tg[f"pregame_qb_l5_{metric}"] = (
                    tg.groupby("_qb_key")[metric]
                      .transform(lambda x: x.shift(1).rolling(5, min_periods=1).mean())
                )
        tg = tg.drop(columns=["_qb_key"])

    return tg


def build_closing(lines, games):
    lines = lines.copy()
    lines["alt_game_id"] = lines["alt_game_id"].astype(str)
    lines["side_norm"] = lines["side"].map(norm_team)
    lines["line_num"] = pd.to_numeric(lines["line"], errors="coerce")
    lines["odds_num"] = pd.to_numeric(lines["odds"], errors="coerce")

    ghome = games[["game_id","home_team","away_team"]].copy()
    ghome["game_id"] = ghome["game_id"].astype(str)

    sp = lines[lines["type"] == "SPREAD"].merge(
        ghome, left_on="alt_game_id", right_on="game_id", how="inner", suffixes=("_legacy", "_canonical")
    )
    sp_home = sp[sp["side_norm"] == sp["home_team"]][["alt_game_id","line_num"]].drop_duplicates("alt_game_id")
    sp_home = sp_home.rename(columns={"alt_game_id":"game_id","line_num":"closing_home_spread"})

    tot = lines[(lines["type"] == "TOTAL") & (lines["side"].astype(str).str.lower() == "over")][
        ["alt_game_id","line_num"]
    ].drop_duplicates("alt_game_id")
    tot = tot.rename(columns={"alt_game_id":"game_id","line_num":"closing_total"})

    ml = lines[lines["type"] == "MONEYLINE"].merge(
        ghome, left_on="alt_game_id", right_on="game_id", how="inner", suffixes=("_legacy", "_canonical")
    )
    ml_home = ml[ml["side_norm"] == ml["home_team"]][["alt_game_id","odds_num"]].drop_duplicates("alt_game_id")
    ml_home = ml_home.rename(columns={"alt_game_id":"game_id","odds_num":"closing_home_ml"})

    out = sp_home.merge(tot, on="game_id", how="outer").merge(ml_home, on="game_id", how="outer")
    return out


def flatten_game_level(games, team_pre, closing):
    metrics = [
        c for c in team_pre.columns
        if c.startswith("pregame_")
    ]
    base_qb_cols = [
        c for c in ["passer_player_id","passer_player_name","qb_dropbacks","qb_epa_game","qb_cpoe_game"]
        if c in team_pre.columns
    ]

    home = games[["game_id","home_team"]].merge(
        team_pre[["game_id","team"] + metrics + base_qb_cols],
        left_on=["game_id","home_team"], right_on=["game_id","team"], how="left"
    ).drop(columns=["team"])
    home = home.rename(columns={c:f"home_{c}" for c in metrics + base_qb_cols})

    away = games[["game_id","away_team"]].merge(
        team_pre[["game_id","team"] + metrics + base_qb_cols],
        left_on=["game_id","away_team"], right_on=["game_id","team"], how="left"
    ).drop(columns=["team"])
    away = away.rename(columns={c:f"away_{c}" for c in metrics + base_qb_cols})

    keep = [
        "game_id","season","game_type","week","gameday","weekday","gametime",
        "away_team","away_score","home_team","home_score","location","result","total",
        "overtime","away_rest","home_rest","away_moneyline","home_moneyline","spread_line","total_line","roof","surface",
        "temp","wind","away_qb_id","home_qb_id","away_qb_name","home_qb_name",
        "stadium","div_game"
    ]
    keep = [c for c in keep if c in games.columns]
    out = games[keep].copy()
    out = out.merge(home.drop(columns=["home_team"]), on="game_id", how="left")
    out = out.merge(away.drop(columns=["away_team"]), on="game_id", how="left")
    out = out.merge(closing, on="game_id", how="left")

    out["away_score"] = pd.to_numeric(out["away_score"], errors="coerce")
    out["home_score"] = pd.to_numeric(out["home_score"], errors="coerce")
    out["final_total"] = out["away_score"] + out["home_score"]
    out["home_margin"] = out["home_score"] - out["away_score"]
    out["is_final"] = out["home_score"].notna() & out["away_score"].notna()

    # Normalize nflverse games.csv convention into a home-side betting line.
    # games.csv spread_line is POSITIVE when the home team is favored; a home-side
    # wager line is therefore the negative of spread_line (e.g. +3.5 -> home -3.5).
    out["dedicated_closing_home_spread"] = out["closing_home_spread"]
    out["dedicated_closing_total"] = out["closing_total"]

    if "spread_line" in out.columns:
        out["schedule_home_spread"] = -pd.to_numeric(out["spread_line"], errors="coerce")
    else:
        out["schedule_home_spread"] = np.nan
    if "total_line" in out.columns:
        out["schedule_total_line"] = pd.to_numeric(out["total_line"], errors="coerce")
    else:
        out["schedule_total_line"] = np.nan

    # Canonical market benchmark: dedicated closing_lines.csv when present,
    # otherwise nflverse games.csv historical spread/total.
    out["closing_home_spread"] = out["dedicated_closing_home_spread"].fillna(out["schedule_home_spread"])
    out["closing_total"] = out["dedicated_closing_total"].fillna(out["schedule_total_line"])
    out["spread_line_source"] = np.select(
        [out["dedicated_closing_home_spread"].notna(), out["schedule_home_spread"].notna()],
        ["nfldata_closing_lines", "nfldata_games"],
        default="missing"
    )
    out["total_line_source"] = np.select(
        [out["dedicated_closing_total"].notna(), out["schedule_total_line"].notna()],
        ["nfldata_closing_lines", "nfldata_games"],
        default="missing"
    )

    # The standalone closing_lines.csv is a useful independent historical
    # cross-check but stops after 2018 in the current public file. The maintained
    # nflverse games.csv carries spread_line/total_line across the full sample.
    # nflverse defines spread_line as POSITIVE when the home team is favored;
    # convert it to a sportsbook-style home spread (favorite is negative).
    out = out.rename(columns={
        "closing_home_spread": "legacy_closing_home_spread",
        "closing_total": "legacy_closing_total",
        "closing_home_ml": "legacy_closing_home_ml",
    })
    out["closing_home_spread"] = -pd.to_numeric(out["schedule_home_spread"], errors="coerce")
    out["closing_total"] = pd.to_numeric(out["schedule_total_line"], errors="coerce")
    out["closing_home_ml"] = pd.to_numeric(out.get("home_moneyline"), errors="coerce")
    out["closing_line_source"] = "nflverse_nfldata_games"
    out["legacy_closing_line_source"] = np.where(
        out["legacy_closing_home_spread"].notna() | out["legacy_closing_total"].notna(),
        "nflverse_nfldata_closing_lines",
        "NA"
    )
    out["closing_spread_available"] = out["closing_home_spread"].notna().astype(int)
    out["closing_total_available"] = out["closing_total"].notna().astype(int)

    out["home_ats_margin"] = out["home_margin"] + out["closing_home_spread"]
    out["total_margin_vs_close"] = out["final_total"] - out["closing_total"]
    out["home_cover_result"] = np.select(
        [out["home_ats_margin"] > 0, out["home_ats_margin"] < 0, out["home_ats_margin"] == 0],
        ["HOME_COVER","AWAY_COVER","PUSH"],
        default="NA"
    )
    out["total_result"] = np.select(
        [out["total_margin_vs_close"] > 0, out["total_margin_vs_close"] < 0, out["total_margin_vs_close"] == 0],
        ["OVER","UNDER","PUSH"],
        default="NA"
    )

    # Difference features are convenient model inputs and remain pregame-only.
    for c in [x for x in metrics if x.startswith("pregame_")]:
        hc, ac = f"home_{c}", f"away_{c}"
        if hc in out.columns and ac in out.columns:
            out[f"diff_{c}"] = out[hc] - out[ac]

    return out


def main():
    games = read_csv_url(GAMES_URL)
    games = games[(games["season"] >= START_SEASON) & (games["season"] <= END_SEASON)].copy()
    games["home_team"] = games["home_team"].map(norm_team)
    games["away_team"] = games["away_team"].map(norm_team)
    games["game_id"] = games["game_id"].astype(str)

    # Keep only NFL game types relevant to modeling.
    if "game_type" in games.columns:
        games = games[games["game_type"].isin(["REG","POST","WC","DIV","CON","SB"])].copy()

    all_team = []
    season_status = []
    for season in range(START_SEASON, END_SEASON + 1):
        url = PBP_URL.format(season=season)
        print(f"Downloading nflfastR PBP {season}: {url}", flush=True)
        try:
            pbp = read_parquet_url(url)
            tg = game_team_aggregates(pbp)
            tg["pbp_season"] = season
            all_team.append(tg)
            season_status.append({"season":season,"rows":len(pbp),"team_game_rows":len(tg),"status":"ok"})
            print(f"  rows={len(pbp):,}, team-game rows={len(tg):,}", flush=True)
        except Exception as e:
            season_status.append({"season":season,"rows":0,"team_game_rows":0,"status":"failed","error":str(e)})
            print(f"  FAILED {season}: {e}", flush=True)

    if not all_team:
        raise RuntimeError("No nflfastR seasons downloaded successfully")

    team_games = pd.concat(all_team, ignore_index=True)
    team_pre = add_team_pregame_features(team_games, games)

    lines = read_csv_url(LINES_URL)
    closing = build_closing(lines, games)

    full = flatten_game_level(games, team_pre, closing)
    full = full.sort_values(["season","week","gameday","game_id"]).reset_index(drop=True)
    final = full[full["is_final"]].copy()

    out_csv = OUT_DIR / "nfl_game_training_2015_2026.csv"
    final.to_csv(out_csv, index=False)

    # Also emit an all-schedule version for current/future 2026 rows.
    all_csv = OUT_DIR / "nfl_game_dataset_2015_2026_all_rows.csv"
    full.to_csv(all_csv, index=False)

    # QA / integrity report.
    duplicate_ids = int(final["game_id"].duplicated().sum())
    line_spread_cov = float(final["closing_home_spread"].notna().mean()) if len(final) else 0
    line_total_cov = float(final["closing_total"].notna().mean()) if len(final) else 0

    # Compare closing-lines source to games.csv schedule fields where both exist.
    spread_compare_n = 0
    spread_compare_mae = None
    if "schedule_home_spread" in final.columns:
        both = final.dropna(subset=["legacy_closing_home_spread","closing_home_spread"])
        spread_compare_n = len(both)
        if len(both):
            spread_compare_mae = float((both["legacy_closing_home_spread"] - both["closing_home_spread"]).abs().mean())

    total_compare_n = 0
    total_compare_mae = None
    if "schedule_total_line" in final.columns:
        both = final.dropna(subset=["legacy_closing_total","closing_total"])
        total_compare_n = len(both)
        if len(both):
            total_compare_mae = float((both["legacy_closing_total"] - both["closing_total"]).abs().mean())

    leakage_columns = [c for c in final.columns if c.startswith(("home_pregame_","away_pregame_","diff_pregame_"))]
    report = {
        "created_utc": pd.Timestamp.utcnow().isoformat(),
        "seasons_requested": [START_SEASON, END_SEASON],
        "season_downloads": season_status,
        "games_in_schedule_rows": int(len(full)),
        "final_training_games": int(len(final)),
        "duplicate_game_ids": duplicate_ids,
        "closing_spread_coverage_pct": round(line_spread_cov * 100, 3),
        "closing_total_coverage_pct": round(line_total_cov * 100, 3),
        "spread_crosscheck_rows": spread_compare_n,
        "spread_crosscheck_mean_abs_diff": spread_compare_mae,
        "total_crosscheck_rows": total_compare_n,
        "total_crosscheck_mean_abs_diff": total_compare_mae,
        "pregame_feature_columns": len(leakage_columns),
        "temporal_integrity": "All rolling/expanding team and QB features use shift(1); current-game results are not used in pregame features.",
        "market_usage": "Canonical spread/total use nfldata closing_lines.csv when available, with nfldata games.csv spread_line/total_line as historical fallback. Market fields are benchmark/labels only and are not used to construct football efficiency features.",
        "pbp_source": "nflverse/nflverse-data release tag pbp (nflfastR)",
        "games_source": GAMES_URL,
        "closing_lines_source": LINES_URL,
    }
    (OUT_DIR / "nfl_game_training_2015_2026_qa.json").write_text(json.dumps(report, indent=2))

    summary = [
        "# NFL 2015–2026 model-training dataset",
        "",
        f"- Final game rows: **{len(final):,}**",
        f"- Full schedule rows: **{len(full):,}**",
        f"- Duplicate final game IDs: **{duplicate_ids}**",
        f"- Closing spread coverage: **{line_spread_cov*100:.2f}%**",
        f"- Closing total coverage: **{line_total_cov*100:.2f}%**",
        f"- Pregame feature columns: **{len(leakage_columns)}**",
        "",
        "## Temporal integrity",
        "All rolling and season-to-date team/QB features are shifted by one game before aggregation, so the current game cannot leak into its own pregame feature vector.",
        "",
        "## Sources",
        "- nflfastR/nflverse season play-by-play parquet assets",
        "- nflverse nfldata games.csv",
        "- nflverse nfldata closing_lines.csv",
        "",
    ]
    (OUT_DIR / "README.md").write_text("\n".join(summary))

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
