#!/usr/bin/env python3
"""Acquire real SDV NBA / NCAA men's CBB possession and independent score releases.

Never backdate source observation times or invent exact tipoff. The output is
a compressed input for the research-only JS source/score validator.
Requires: polars, requests. No proprietary NBA live endpoint calls.
"""
from collections import defaultdict
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys
import requests
import polars as pl

SPORT = os.environ.get("FBIS_BASKETBALL_SPORT", "nba").lower()
SEASON = int(os.environ.get("FBIS_BASKETBALL_SEASON", "2026"))
OUT = Path(os.environ.get("FBIS_BASKETBALL_OUT", "artifacts/basketball-sdv"))
if SPORT not in ("nba", "cbb") or SEASON < 2015 or SEASON > 2026:
    raise SystemExit("invalid sport/season")
ROOT = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
URLS = {
    "nba": [
        ("possession", f"{ROOT}/nba_stats_possessions/nba_possessions_{SEASON}.parquet"),
        ("schedule", f"{ROOT}/nba_stats_schedules/nba_schedule_{SEASON}.parquet"),
    ],
    "cbb": [
        ("possession", f"{ROOT}/ncaa_mbb_possessions/ncaa_mbb_possessions_{SEASON}.parquet"),
        ("schedule", f"{ROOT}/ncaa_mbb_schedule/ncaa_mbb_schedule_{SEASON}.parquet"),
    ],
}
COLS = {
    "nba": {
        "possession": ("game_id", "period", "possession_number", "start_order_index",
                       "offense_team_id", "defense_team_id", "points", "count_as_possession"),
        "schedule": ("game_id", "game_date", "home_team_id", "away_team_id",
                     "home_team_abbreviation", "away_team_abbreviation",
                     "home_pts", "away_pts"),
    },
    "cbb": {
        "possession": ("contest_id", "period", "poss_num", "poss_team_ncaa_team_id",
                       "home_ncaa_team_id", "away_ncaa_team_id", "home", "away", "pts"),
        "schedule": ("contest_id", "game_date", "home", "away", "home_score", "away_score"),
    },
}
KEY = "game_id" if SPORT == "nba" else "contest_id"
OUT.mkdir(parents=True, exist_ok=True)
sources = {}
frames = {}
for family, url in URLS[SPORT]:
    destination = OUT / f"{SPORT}-{SEASON}-{family}.parquet"
    digest = hashlib.sha256()
    with requests.get(url, timeout=(30, 240), stream=True, allow_redirects=True,
                      headers={"User-Agent": "FBIS-IndependentBasketballSDV/0.2"}) as resp:
        resp.raise_for_status()
        with destination.open("wb") as handle:
            for chunk in resp.iter_content(chunk_size=2**20):
                if chunk:
                    handle.write(chunk)
                    digest.update(chunk)
    sha = digest.hexdigest()
    df = pl.read_parquet(str(destination))
    missing = sorted(set(COLS[SPORT][family]) - set(df.columns))
    if missing:
        raise RuntimeError(f"SDV_RELEASE_SCHEMA_MISMATCH {SPORT} {family}: {missing}")
    frames[family] = df.select(list(COLS[SPORT][family]))
    sources[family] = {"url": url, "sha256": sha, "bytes": destination.stat().st_size,
                       "rows": df.height, "columns": df.columns,
                       "sourceType": "SPORTSDATAVERSE_GITHUB_RELEASE"}
    del df

now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
schedules = {}
duplicates = set()
for row in frames["schedule"].iter_rows(named=True):
    gid = str(row.get(KEY) or "")
    if not gid: continue
    if gid in schedules:
        duplicates.add(gid)
    else:
        schedules[gid] = row
if duplicates:
    raise RuntimeError(f"SDV_DUPLICATE_OFFICIAL_SCHEDULE_GAMES {len(duplicates)}")
grouped = defaultdict(list)
for row in frames["possession"].iter_rows(named=True):
    gid = str(row.get(KEY) or "")
    if gid:
        grouped[gid].append(row)
del frames
out_file = OUT / f"{SPORT}-{SEASON}-source.jsonl.gz"
considered = 0
with gzip.open(out_file, "wt", encoding="utf8", compresslevel=6) as output:
    for gid in sorted(grouped):
        schedule = schedules.get(gid)
        if not schedule: continue
        # NBA: schedule/game ID identifies regular season via 3rd digit "2".
        # Other competitions have different clocks and must not be mixed.
        if SPORT == "nba" and (len(gid) < 3 or gid[2] != "2"):
            continue
        # Season date is a DAY, not an exact UTC tipoff.
        # Leave it unresolved until independently verified fixture evidence.
        row = {"sport": SPORT, "season": SEASON, "gameId": gid,
               "rows": grouped[gid], "schedule": schedule,
               "observedAt": now, "tipoff": None, "tipoffEvidence": None,
               "sourceArtifactHash": sources["possession"]["sha256"],
               "scheduleArtifactHash": sources["schedule"]["sha256"]}
        output.write(json.dumps(row, separators=(",", ":"), default=str) + "\n")
        considered += 1
manifest = {
    "ok": True, "mode": "HISTORICAL_SOURCE_AUDIT_ONLY",
    "sport": SPORT, "season": SEASON, "generatedAt": now,
    "datasets": sources, "scheduleGames": len(schedules),
    "possessionGames": len(grouped), "joinedGames": considered,
    "sourceRows": sum(len(x) for x in grouped.values()),
    "sourceArtifact": str(out_file),
    "authoritativeTipoffsAttached": 0,
    "historicalProspectiveCount": 0,
    "marketInput": False, "canQualify": False, "canAuthorizeWager": False
}
(OUT / f"{SPORT}-{SEASON}-acquisition.json").write_text(
    json.dumps(manifest, indent=2) + "\n", encoding="utf8")
print(json.dumps({k: v for k, v in manifest.items()
                  if k not in ("datasets",)}, indent=2))
if considered < (200 if SPORT == "nba" else 500):
    raise RuntimeError(f"INSUFFICIENT_REAL_SDV_RELEASE_GAMES {SPORT}: {considered}")
