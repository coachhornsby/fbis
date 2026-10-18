#!/usr/bin/env python3
"""
Enrich an nflverse feature snapshot with PBP-derived success / early-down /
explosive rates (leakage-safe season-to-date prior via shift semantics at build time).

Does NOT invent trenches or special-teams values — those remain null until an
authorized source exists.

Usage:
  python scripts/nfl-enrich-snapshot-pbp-families.py \
    --snapshot artifacts/nfl-features/latest.json \
    --out artifacts/nfl-features/latest.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

RELEASE = "https://github.com/nflverse/nflverse-data/releases/download"


def safe_mean(s):
    s = pd.to_numeric(s, errors="coerce")
    return float(s.mean()) if s.notna().any() else None


def season_team_features(pbp: pd.DataFrame) -> dict:
    """Aggregate REG season-to-date team rates (postgame labels for prior games only when shifted upstream)."""
    if pbp.empty:
        return {}
    pbp = pbp.copy()
    pbp["epa_num"] = pd.to_numeric(pbp.get("epa"), errors="coerce")
    pbp["success_num"] = pd.to_numeric(pbp.get("success"), errors="coerce")
    pbp["down_num"] = pd.to_numeric(pbp.get("down"), errors="coerce")
    yards = pd.to_numeric(pbp.get("yards_gained"), errors="coerce")
    pbp["explosive"] = ((pbp.get("pass_attempt").fillna(0).astype(float) == 1) & (yards >= 20)) | (
        (pbp.get("rush_attempt").fillna(0).astype(float) == 1) & (yards >= 10)
    )
    pbp["early_down"] = pbp["down_num"].isin([1, 2]).astype(int)
    out = {}
    for team, g in pbp.groupby(pbp["posteam"].astype(str)):
        if not team or team == "nan":
            continue
        early = g[g["early_down"] == 1]
        out[team] = {
            "successRate": safe_mean(g["success_num"]),
            "earlyDownEpa": safe_mean(early["epa_num"]),
            "explosiveRate": safe_mean(g["explosive"].astype(float)),
            "pbpPlays": int(len(g)),
            "pbpSource": "nflverse-pbp",
        }
    # Defense allowed: group by defteam
    for team, g in pbp.groupby(pbp["defteam"].astype(str)):
        if not team or team == "nan":
            continue
        early = g[g["early_down"] == 1]
        row = out.setdefault(team, {"pbpSource": "nflverse-pbp"})
        row["successRateAllowed"] = safe_mean(g["success_num"])
        row["earlyDownEpaAllowed"] = safe_mean(early["epa_num"])
        row["explosiveRateAllowed"] = safe_mean(g["explosive"].astype(float))
        row["pbpDefPlays"] = int(len(g))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--season", type=int, default=None)
    args = ap.parse_args()

    snap_path = Path(args.snapshot)
    snap = json.loads(snap_path.read_text())
    season = args.season or int(snap.get("season") or 2026)
    url = f"{RELEASE}/pbp/play_by_play_{season}.parquet"
    print(json.dumps({"phase": "download", "url": url}), flush=True)
    try:
        pbp = pd.read_parquet(url, columns=[
            "posteam", "defteam", "season_type", "epa", "success", "down",
            "yards_gained", "pass_attempt", "rush_attempt", "fixed_drive",
        ])
    except Exception as exc:
        print(json.dumps({"ok": False, "error": "pbp-download-failed", "detail": str(exc)}))
        sys.exit(1)

    pbp = pbp[pbp["season_type"].astype(str).str.upper() == "REG"]
    feats = season_team_features(pbp)
    by_team = snap.setdefault("byTeam", {})
    enriched = 0
    still_null = {"trenches": True, "specialTeams": True}
    for team, row in by_team.items():
        add = feats.get(team) or feats.get(str(team).upper()) or {}
        if not add:
            continue
        for k in ("successRate", "successRateAllowed", "earlyDownEpa", "earlyDownEpaAllowed", "explosiveRate", "explosiveRateAllowed"):
            if add.get(k) is not None:
                row[k] = add[k]
                enriched += 1
        row["pbpFamilyStatus"] = {
            "success": add.get("successRate") is not None,
            "earlyDown": add.get("earlyDownEpa") is not None,
            "explosives": add.get("explosiveRate") is not None,
            "trenches": False,
            "specialTeams": False,
            "note": "trenches/specialTeams remain null — no authorized live source in this enricher",
        }
    meta = snap.setdefault("meta", {})
    meta["snapshotSchema"] = "nflverse-features-v5"
    families = list(meta.get("featureFamilies") or [])
    for fam in ("success_rate", "early_down_epa", "explosive_rate"):
        if fam not in families:
            families.append(fam)
    meta["featureFamilies"] = families
    meta["pbpFamilyEnrichment"] = {
        "season": season,
        "teamsWithPbp": len(feats),
        "fieldsWritten": enriched,
        "stillNullFamilies": ["trenches", "specialTeams"],
        "leakageNote": "Season-to-date REG aggregates for snapshot refresh; board attach still uses availability timestamps from snapshot builtAt.",
    }
    Path(args.out).write_text(json.dumps(snap))
    print(json.dumps({
        "ok": True,
        "out": args.out,
        "teams": len(by_team),
        "pbpTeams": len(feats),
        "fieldsWritten": enriched,
        "stillNull": still_null,
    }))


if __name__ == "__main__":
    main()
