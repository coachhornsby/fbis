#!/usr/bin/env python3
"""One-shot, bounded CFBD+CBBD source coverage audit. No production writes."""
import datetime as dt
import hashlib
import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request

SEASON_CFB = 2026
SEASON_CBB = 2027  # ending year; 2026–27
MAX_CALLS = 16
MAX_BYTES = 3_000_000
PER_CALL_TIMEOUT = 16
BASES = {"cfbd": "https://api.collegefootballdata.com",
         "cbbd": "https://api.collegebasketballdata.com"}
# These calls measure the existence, identity, and broad shape of central data families.
# They do NOT claim full-season reconciliation or comprehensive player/prop availability.
PROBES = [
 ("cfbd", "fbs_directory", "/teams/fbs", {"year": SEASON_CFB}, "directory"),
 ("cfbd", "week10_schedule", "/games", {"year": SEASON_CFB, "week": 10, "classification": "fbs"}, "games"),
 ("cfbd", "week10_team_boxes", "/games/teams", {"year": SEASON_CFB, "week": 10, "classification": "fbs"}, "boxes"),
 ("cfbd", "texas_player_boxes", "/games/players", {"year": SEASON_CFB, "week": 10, "team": "Texas"}, "boxes"),
 ("cfbd", "texas_season_stats", "/stats/season", {"year": SEASON_CFB, "team": "Texas"}, "records"),
 ("cfbd", "texas_advanced", "/stats/season/advanced", {"year": SEASON_CFB, "team": "Texas"}, "records"),
 ("cfbd", "core_ratings", "/ratings/core", {"year": SEASON_CFB}, "records"),
 ("cfbd", "texas_roster", "/roster", {"year": SEASON_CFB, "team": "Texas"}, "records"),
 ("cbbd", "division_directory", "/teams/directory", {"season": SEASON_CBB}, "directory_object"),
 ("cbbd", "duke_season_games", "/games", {"season": SEASON_CBB, "team": "Duke"}, "games"),
 ("cbbd", "duke_team_boxes", "/games/teams", {"season": SEASON_CBB, "team": "Duke"}, "boxes"),
 ("cbbd", "duke_player_boxes", "/games/players", {"season": SEASON_CBB, "team": "Duke"}, "boxes"),
 ("cbbd", "current_adjusted", "/ratings/adjusted", {"season": SEASON_CBB}, "records"),
 ("cbbd", "prior_adjusted", "/ratings/adjusted", {"season": 2026}, "records"),
 ("cbbd", "current_team_stats", "/stats/team/season", {"season": SEASON_CBB, "team": "Duke"}, "records"),
 ("cbbd", "prior_team_stats", "/stats/team/season", {"season": 2026, "team": "Duke"}, "records")
]
assert len(PROBES) == MAX_CALLS

def read_provider(source, route, filters, key):
    url = BASES[source] + route + "?" + urllib.parse.urlencode(filters)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + key, "Accept": "application/json",
                                               "User-Agent": "FBIS-GitHub-Coverage/1.0"})
    with urllib.request.urlopen(req, timeout=PER_CALL_TIMEOUT) as response:
        data = response.read(MAX_BYTES + 1)
        status = response.status
    if len(data) > MAX_BYTES:
        raise OverflowError("response_exceeds_3MB")
    return status, data

def shape_summary(payload, kind):
    if kind == "directory_object":
        if not isinstance(payload, dict) or not isinstance(payload.get("teams"), list):
            raise ValueError("invalid_directory_envelope")
        records = payload["teams"]
        return records, {"season": payload.get("season"), "conferences": len(payload.get("conferences") or [])}
    if not isinstance(payload, list):
        raise ValueError("expected_array")
    return payload, {}

def ids_and_fields(records, kind):
    if not records:
        return {"records": 0, "distinctIds": 0, "missingIds": 0, "duplicateIds": 0,
                "missingFieldRates": {}, "status": "EMPTY_NOT_ZERO"}
    candidates = ("id", "gameId", "teamId", "playerId") if kind != "directory" else ("id", "teamId")
    idfield = next((k for k in candidates if any(isinstance(r, dict) and r.get(k) is not None for r in records)), None)
    ids = [str(r.get(idfield)) for r in records if idfield and isinstance(r, dict) and r.get(idfield) is not None]
    presence = {}
    for field in ("id", "gameId", "teamId", "team", "school", "homeTeam", "awayTeam",
                  "homeScore", "awayScore", "startDate", "season", "teams", "players",
                  "stats", "offense", "defense"):
        if any(isinstance(r, dict) and field in r for r in records):
            presence[field] = sum(isinstance(r, dict) and r.get(field) is None for r in records)
    return {"records": len(records), "idField": idfield,
            "distinctIds": len(set(ids)), "missingIds": len(records) - len(ids),
            "duplicateIds": len(ids) - len(set(ids)),
            "nullFields": presence,
            "status": "RESPONSE_OBSERVED"}

def verdict(rows):
    failed = [r for r in rows if r["status"] == "ERROR"]
    missing = [r for r in rows if r["status"] == "EMPTY_NOT_ZERO"]
    return "BLOCKED" if failed else "PARTIAL_DATA" if missing else "SAMPLE_VERIFIED_FULL_COVERAGE_UNPROVEN"

def audit(out: pathlib.Path):
    key = os.environ.get("CFBD_CBBD_KEY", "")
    if not key:
        raise RuntimeError("GitHub Actions source credential unavailable")
    rows = []
    out.mkdir(parents=True, exist_ok=True)
    for source, label, route, filters, kind in PROBES:
        entry = {"source": source, "probe": label, "endpoint": route,
                 "filters": filters, "status": "ERROR", "providerStatus": None}
        try:
            status, data = read_provider(source, route, filters, key)
            payload = json.loads(data)
            records, extra = shape_summary(payload, kind)
            summary = ids_and_fields(records, kind)
            entry.update(summary)
            entry.update(extra)
            entry["providerStatus"] = status
            entry["responseBytes"] = len(data)
            entry["sha256"] = hashlib.sha256(data).hexdigest()
            entry["observedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
            if label == "division_directory":
                # The directory may include non-D1 programs; do not equate all teams with D1.
                entry["note"] = "Directory count is not automatically Division I membership count."
            if label == "current_adjusted" and not records:
                entry["note"] = "No observed ratings for current season; do not substitute prior silently."
        except urllib.error.HTTPError as exc:
            entry.update({"errorType": "HTTPError", "providerStatus": exc.code})
        except (urllib.error.URLError, ValueError, OverflowError, TimeoutError) as exc:
            entry["errorType"] = type(exc).__name__
        rows.append(entry)
        print(json.dumps({k: entry.get(k) for k in ("source", "probe", "status", "providerStatus", "records", "errorType")}), flush=True)
    result = {"schemaVersion": 1,
              "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
              "cfbSeason": SEASON_CFB, "cbbSeason": SEASON_CBB,
              "requestCount": len(rows), "maximumRequests": MAX_CALLS,
              "result": verdict(rows), "fullCoverageEstablished": False,
              "providerDataPublished": False, "promotedToProduction": False,
              "cloudflareReads": 0, "cloudflareWrites": 0,
              "unverifiedDimensions": ["all 2026 FBS team IDs against independent roster",
                "all 2026 football schedule/game results and postseason",
                "each football team-game and player-game box, plays, efficiency and ratings",
                "all 2026-27 Division I basketball IDs against verified membership",
                "every basketball date-scoped game/box including low-division opponents",
                "every player-game roster join, injury/availability and ratings timestamps",
                "historical season/date partitions, source publication times",
                "independent ESPN/official scoreboard reconciliation and all provider entitlements"],
              "probes": rows}
    (out / "coverage-report.json").write_text(json.dumps(result, indent=2) + "\n")
    (out / "coverage-summary.md").write_text(render_md(result))
    return result

def render_md(result):
    lines = ["# FBIS CFBD / CBBD — bounded coverage audit",
             "", "Result: **" + result["result"] + "**",
             "", "This is an API *coverage probe*, not a complete season import.",
             "No production data or Cloudflare DB changed.",
             "", "| Provider | Dataset | HTTP | Rows | Status |",
             "|---|---|---:|---:|---|"]
    for p in result["probes"]:
        lines.append("| " + " | ".join(str(x) for x in
            (p["source"], p["probe"], p.get("providerStatus") or "—", p.get("records", "—"), p["status"])) + " |")
    lines += ["", "## Unverified dimensions"] + ["- " + x for x in result["unverifiedDimensions"]]
    return "\n".join(lines) + "\n"

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="artifacts/college-coverage-audit")
    args = p.parse_args()
    r = audit(pathlib.Path(args.output))
    print("COVERAGE_VERDICT="+r["result"])
    # A coverage probe may find missing endpoints. Preserve the evidence without approving production.
