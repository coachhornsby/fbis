#!/usr/bin/env python3
"""Historical SportsDataverse advanced CFB team-game collection: research only.

No production D1 writes, no past PIT publication timestamp invention, no
model updates, promotions or wagering authority.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import urllib.request

BASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download"
SOURCES = {
    "schedule": ("espn_cfb_schedules", "cfb_schedule_{year}.csv"),
    "advanced": ("espn_cfb_adv_team_gamelog", "adv_team_gamelog_{year}.csv"),
}
METADATA = {
    "season", "week", "season_type", "game_id", "start_date", "team_id", "team",
    "opponent_id", "opponent", "is_home", "neutral_site", "points_for",
    "points_against", "margin", "win", "game_status", "completed", "status",
}
OUTCOME_PREFIX = ("postgame_", "final_", "home_score", "away_score", "home_points", "away_points")
MAX_BYTES = 25_000_000


def asset_url(kind: str, year: int) -> str:
    tag, name = SOURCES[kind]
    if not 2004 <= year <= 2026:
        raise ValueError("year is out of the vetted SDV coverage range")
    return f"{BASE}/{tag}/{name.format(year=year)}"


def acquire(kind, year, input_dir=None):
    url = asset_url(kind, year)
    if input_dir:
        b = (Path(input_dir) / f"{kind}_{year}.csv").read_bytes()
        headers = {}
    else:
        req = urllib.request.Request(url, headers={"User-Agent": "FBIS-Research-Historical-Audit/1.0"})
        with urllib.request.urlopen(req, timeout=65) as response:
            if int(response.headers.get("Content-Length") or 0) > MAX_BYTES:
                raise ValueError(f"SDV {kind}/{year} declared asset too large")
            b = response.read(MAX_BYTES + 1)
            headers = {key: response.headers.get(key) for key in ("ETag", "Last-Modified", "Content-Length")}
    if len(b) > MAX_BYTES or len(b) < 20:
        raise ValueError(f"SDV {kind}/{year} invalid asset size {len(b)}")
    txt = b.decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(txt)))
    if not rows or any(None in r for r in rows):
        raise ValueError(f"Invalid CSV rows {kind}/{year}")
    return b, rows, {
        "kind": kind, "year": year, "url": url,
        "sha256": hashlib.sha256(b).hexdigest(), "bytes": len(b),
        "rows": len(rows), "http_headers": headers,
        "temporal_class": "POSTGAME_HISTORICAL_RELEASE_ONLY",
        "original_publication_at": None, "original_publication_verified": False,
    }


def flag(v):
    return str(v or "").strip().lower() in ("true", "1", "yes", "t")


def number(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (ValueError, TypeError):
        return None


def key(v):
    value = str(v or "").strip()
    return value if re.fullmatch(r"\d{1,20}", value) else None


def parse_schedule(rows, year):
    required = ("game_id", "season", "start_date", "home_id", "away_id",
                "home_division", "away_division", "completed", "home_points", "away_points")
    if any(x not in rows[0] for x in required):
        raise ValueError("Schedule schema has drifted: " + str([x for x in required if x not in rows[0]]))
    eligible, rejected = {}, Counter()
    for row in rows:
        if str(row.get("season")) != str(year):
            rejected["wrong_season"] += 1
            continue
        if row["home_division"].lower() != "fbs" or row["away_division"].lower() != "fbs":
            rejected["not_fbs_vs_fbs"] += 1
            continue
        if not flag(row["completed"]):
            rejected["not_complete"] += 1
            continue
        gid, home, away = key(row["game_id"]), key(row["home_id"]), key(row["away_id"])
        hs, ass = number(row["home_points"]), number(row["away_points"])
        if not gid or not home or not away or home == away or hs is None or ass is None or not row["start_date"]:
            rejected["unresolved_schedule"] += 1
            continue
        if gid in eligible:
            raise ValueError("Duplicate canonical game id in schedule: " + gid)
        eligible[gid] = {
            "season": year, "game_id": gid, "kickoff": row["start_date"],
            "home_id": home, "away_id": away,
            "home_points": hs, "away_points": ass,
        }
    return eligible, rejected


def numeric_catalog(rows):
    catalog = []
    for name in rows[0]:
        if name in METADATA or name.lower().startswith(OUTCOME_PREFIX):
            continue
        valid = sum(number(r.get(name)) is not None for r in rows)
        if valid:
            catalog.append({
                "name": name, "numeric_rows": valid,
                "coverage_all_rows": round(valid / len(rows), 4),
            })
    return catalog


def match_advanced(rows, schedule, year, feature_names):
    required = ("season", "game_id", "team_id", "opponent_id",
                "is_home", "points_for", "points_against")
    if any(x not in rows[0] for x in required):
        raise ValueError("Advanced gamelog schema drift: " + str([x for x in required if x not in rows[0]]))
    seen = set()
    accepted = []
    rejected = Counter()
    features = set(feature_names)
    for row in rows:
        if str(row.get("season")) != str(year):
            rejected["wrong_season"] += 1
            continue
        gid = key(row.get("game_id"))
        game = schedule.get(gid)
        if not game:
            rejected["not_verified_fbs_final"] += 1
            continue
        tid, opp = key(row.get("team_id")), key(row.get("opponent_id"))
        home = flag(row.get("is_home"))
        expected = game["home_id"] if home else game["away_id"]
        other = game["away_id"] if home else game["home_id"]
        if tid != expected or opp != other:
            rejected["team_identity_conflict"] += 1
            continue
        if (gid, tid) in seen:
            raise ValueError("Duplicate advanced team-game observation: " + str((gid, tid)))
        pf, pa = number(row.get("points_for")), number(row.get("points_against"))
        if pf != (game["home_points"] if home else game["away_points"]) or pa != (game["away_points"] if home else game["home_points"]):
            rejected["result_score_conflict"] += 1
            continue
        seen.add((gid, tid))
        metric = {k: x for k in features if (x := number(row.get(k))) is not None}
        if not metric:
            rejected["no_numeric_metrics"] += 1
            continue
        accepted.append({
            "season": year, "game_id": gid, "team_id": tid, "opponent_id": opp,
            "kickoff": game["kickoff"], "is_home": home,
            "metrics": dict(sorted(metric.items())),
            "temporal_class": "POSTGAME_ONLY",
            "can_influence_projection": False, "source_publication_verified": False,
        })
    by_game = defaultdict(set)
    for record in accepted:
        by_game[record["game_id"]].add(record["team_id"])
    complete = {gid for gid, teams in by_game.items() if teams == {schedule[gid]["home_id"], schedule[gid]["away_id"]}}
    return (
        [record for record in accepted if record["game_id"] in complete],
        rejected,
        {
            "matched_teams": len(accepted), "paired_fbs_games": len(complete),
            "unpaired_team_rows": len(accepted) - len(complete) * 2,
            "eligible_schedule_games": len(schedule),
            "coverage_of_eligible_schedule_games": round(len(complete) / len(schedule), 4) if schedule else 0,
        },
    )


def write_new(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(payload)


def collect(years, out, input_dir=None):
    out = Path(out)
    if out.exists():
        raise FileExistsError("Research destination exists; immutable runs must not overwrite")
    out.mkdir(parents=True)
    manifest = {
        "schema_version": 1, "years": list(years), "assets": [], "seasons": {},
        "data_classification": "HISTORICAL_POSTGAME_ONLY",
        "pit_certified": False, "can_influence_projection": False,
        "can_authorize_wager": False, "model_promotion_allowed": False,
        "historical_source_publication_verified": False,
        "source": "SDV ESPN per-team game logs and schedules (current historical releases)",
        "note": "Earlier-game rolling features are retrospective candidates until first-publication clocks are proven.",
    }
    all_rows, catalogs = [], {}
    for year in years:
        raw = {}
        for kind in SOURCES:
            data, rows, receipt = acquire(kind, year, input_dir)
            write_new(out / "raw" / f"{kind}_{year}.csv", data)
            manifest["assets"].append(receipt)
            raw[kind] = rows
        schedule, schedule_rejections = parse_schedule(raw["schedule"], year)
        catalog = numeric_catalog(raw["advanced"])
        accepted, rejected, stats = match_advanced(
            raw["advanced"], schedule, year, [x["name"] for x in catalog]
        )
        all_rows.extend(accepted)
        manifest["seasons"][str(year)] = {
            "schedule_rejections": dict(schedule_rejections),
            "advanced_rejections": dict(rejected),
            "advanced_asset_rows": len(raw["advanced"]),
            "numeric_advanced_metrics": len(catalog), **stats,
        }
        catalogs[year] = catalog
    all_rows.sort(key=lambda row: (row["kickoff"], row["game_id"], row["team_id"]))
    write_new(
        out / "advanced_team_game_final.jsonl",
        ("".join(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n" for row in all_rows)).encode(),
    )
    write_new(out / "advanced_numeric_catalog.json", json.dumps(catalogs, indent=2, sort_keys=True).encode())
    write_new(out / "manifest.json", json.dumps(manifest, indent=2, sort_keys=True).encode())
    print(json.dumps({
        "status": "RESEARCH_POSTGAME_ONLY", "paired_team_games": len(all_rows),
        "pit_certified": False, "manifest": str(out / "manifest.json"),
        "season_qa": manifest["seasons"],
    }, indent=2))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--years", nargs="+", type=int, default=[2021, 2022, 2023, 2024, 2025])
    parser.add_argument("--out", required=True)
    parser.add_argument("--input-dir", help="Local deterministic fixture CSVs, for tests only")
    args = parser.parse_args()
    collect(args.years, args.out, args.input_dir)


if __name__ == "__main__":
    main()
