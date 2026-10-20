#!/usr/bin/env python3
"""Produce a research-only NBA last-five regular-season history from SDV releases.

No bets, no live prices, no model promotion. Identity is ESPN athlete_id,
matching FBIS's nba:espn:<id>. Production activation is separately gated.
"""
import argparse
import hashlib
import json
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

SOURCE = "SDV_ESPN_NBA_PLAYER_BOXSCORES"
PROVENANCE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_nba_player_boxscores"
STAT_FIELDS = {
    "points": "points", "rebounds": "rebounds", "assists": "assists",
    "three_pointers_made": "three_point_field_goals_made",
}
LIMITS = {"minutes": 75, "points": 100, "rebounds": 60, "assists": 40,
          "three_pointers_made": 25}

def numeric(value, maximum):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
        if result != result or result < 0 or result > maximum:
            return None
        return round(result, 3)
    except (TypeError, ValueError, OverflowError):
        return None

def normalize(records, cutoff):
    """Only completed pre-cutoff regular season appearances; fail closed."""
    grouped = defaultdict(list)
    for r in records:
        athlete = str(r.get("athlete_id") or "")
        game = str(r.get("game_id") or "")
        played = str(r.get("game_date") or "")[:10]
        try:
            current = date.fromisoformat(played)
        except (ValueError, TypeError):
            continue
        if (not athlete.isdigit() or not game.isdigit() or
                current >= cutoff or str(r.get("season_type")) not in ("2", "2.0") or
                r.get("did_not_play") in (True, 1, "True", "TRUE")):
            continue
        minutes = numeric(r.get("minutes"), LIMITS["minutes"])
        if minutes is None or minutes == 0:
            continue
        stats = {k: numeric(r.get(col), LIMITS[k]) for k, col in STAT_FIELDS.items()}
        if any(x is None for x in stats.values()):
            continue
        grouped[athlete].append({
            "gameId": game, "date": played, "season": int(r.get("season") or 0),
            "seasonType": 2, "minutes": minutes, **stats,
        })
    result = []
    for athlete, entries in sorted(grouped.items(), key=lambda x: int(x[0])):
        unique = {}
        for r in sorted(entries, key=lambda x: (x["date"], x["gameId"]), reverse=True):
            unique.setdefault(r["gameId"], r)
        last = list(unique.values())[:5]
        if last:
            result.append({"espnPlayerId": athlete, "games": last})
    return result

def create_snapshot(frames, cutoff, *, generated_at):
    entries = normalize(frames, cutoff)
    payload = {
        "version": 1, "source": SOURCE, "mode": "SHADOW_RESEARCH_ONLY",
        "seasonType": "NBA_REGULAR_SEASON_ONLY", "generatedAt": generated_at,
        "asOfDayExclusive": cutoff.isoformat(), "provenance": PROVENANCE,
        "licenseAttribution": "SportsDataverse data releases (CC BY 4.0); ESPN-origin box scores",
        "canQualify": False, "canAuthorizeWager": False,
        "playerCount": len(entries), "entries": entries,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    payload["contentSha256"] = digest
    return payload

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cutoff-day", default=datetime.now(timezone.utc).date().isoformat())
    parser.add_argument("--seasons", default="2026,2027")
    parser.add_argument("--out", default="artifacts/sdv-nba-last5-shadow.json")
    a = parser.parse_args()
    cutoff = date.fromisoformat(a.cutoff_day)
    import sportsdataverse.nba as nba
    rows = []
    failures = []
    for season in sorted(set(int(s.strip()) for s in a.seasons.split(",") if s.strip())):
        try:
            frame = nba.load_nba_player_boxscore(seasons=[season])
            if frame is None:
                failures.append({"season": season, "reason": "NO_ASSET"})
                continue
            segment = frame.to_dicts() if hasattr(frame, "to_dicts") else frame.to_dict("records")
            if not isinstance(segment, list):
                raise ValueError("UNEXPECTED_FRAME_SHAPE")
            rows.extend(segment)
        except Exception as ex:
            failures.append({"season": season, "reason": type(ex).__name__})
    result = create_snapshot(rows, cutoff, generated_at=datetime.now(timezone.utc).isoformat())
    result["requestedSeasons"] = a.seasons
    result["sourceFailures"] = failures
    if not result["playerCount"]:
        raise SystemExit("SDV_NBA_NO_VERIFIED_GAME_LOGS")
    dest = Path(a.out)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"ok": True, "source": SOURCE, "players": result["playerCount"],
                      "failures": failures, "mode": result["mode"], "artifact": str(dest)}))

if __name__ == "__main__":
    main()
