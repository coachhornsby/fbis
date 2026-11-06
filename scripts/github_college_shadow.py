#!/usr/bin/env python3
"""FBIS college-source GitHub Actions shadow capture. No Cloudflare, no model promotion."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

BASE = {
    "cfbd": "https://api.collegefootballdata.com",
    "cbbd": "https://api.collegebasketballdata.com",
}
MAX_BYTES = 2_000_000
MAX_ROWS = 250
MAX_CALLS = 2
TIMEOUT = 12


def validate(year: int, week: int, team: str) -> None:
    if not 2020 <= year <= 2030 or not 1 <= week <= 20:
        raise ValueError("season/week outside bounded capture range")
    if not team or len(team) > 70 or not all(c.isalnum() or c in " .'-" for c in team):
        raise ValueError("team filter required for CBBD; invalid team")


def jobs(year: int, week: int, team: str):
    # CFBD uses a calendar season year; CBBD uses the ENDING year of the season.
    return [
        ("cfbd", "/games", {"year": str(year), "week": str(week), "team": "Texas"}),
        ("cbbd", "/games", {"season": str(year + 1), "team": team}),
    ]


def fetch(source: str, route: str, query: dict, key: str) -> tuple:
    url = BASE[source] + route + "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer " + key,
            "Accept": "application/json",
            "User-Agent": "FBIS-GitHub-Shadow/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
        data = response.read(MAX_BYTES + 1)
        status = response.status
    if len(data) > MAX_BYTES:
        raise RuntimeError(f"{source} response too large; rejected without publishing")
    payload = json.loads(data)
    if not isinstance(payload, list):
        raise RuntimeError(f"{source} expected list; rejected")
    if len(payload) >= MAX_ROWS:
        raise RuntimeError(f"{source} >= {MAX_ROWS} rows; partition or paginate before use")
    # No key, Authorization header, or URL is written to artifacts.
    return status, payload


def capture(outdir: Path, year: int, week: int, team: str, network: bool) -> dict:
    validate(year, week, team)
    outdir.mkdir(parents=True, exist_ok=True)
    receipt = {
        "schemaVersion": 1,
        "mode": "shadow" if network else "dry-run",
        "productionAuthority": False,
        "promotionAllowed": False,
        "providerKeysWritten": False,
        "providerCallsCeiling": MAX_CALLS,
        "modelsExecuted": False,
        "cloudflareReads": 0,
        "cloudflareWrites": 0,
        "sources": [],
        "status": "NOT_RUN",
    }
    if not network:
        receipt["status"] = "DRY_RUN_NO_NETWORK"
        receipt["planned"] = [{"source": s, "route": route, "filters": params} for s, route, params in jobs(year, week, team)]
    else:
        key = os.environ.get("CFBD_CBBD_KEY", "")
        if not key:
            raise RuntimeError("CFBD_CBBD_KEY must be configured in GitHub Actions secrets")
        errors = []
        for source, route, params in jobs(year, week, team):
            row = {"source": source, "route": route, "filters": params, "status": "FAILED"}
            try:
                http, records = fetch(source, route, params, key)
                # Store complete immutable input exactly as received, not a partial data subset.
                raw = json.dumps(records, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
                path = outdir / (source + ".json")
                path.write_bytes(raw)
                row.update(
                    {
                        "status": "CAPTURED",
                        "httpStatus": http,
                        "count": len(records),
                        "sha256": hashlib.sha256(raw).hexdigest(),
                        "bytes": len(raw),
                        "file": path.name,
                        "capturedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                        "providerPublicationAt": None,
                        "priceFreshness": "UNVERIFIED",
                        "settlementAuthority": False,
                    }
                )
            except urllib.error.HTTPError as exc:
                # Response code alone is safe to log; provider error bodies can contain account details.
                row["errorType"] = "HTTPError"
                row["httpStatus"] = exc.code
                errors.append(source)
            except (urllib.error.URLError, TimeoutError, ValueError, RuntimeError) as exc:
                # Avoid storing exception strings: some libraries may include full signed URLs.
                row["errorType"] = type(exc).__name__
                errors.append(source)
            receipt["sources"].append(row)
        receipt["status"] = "CAPTURED" if not errors else "INCOMPLETE"
        for row in receipt["sources"]:
            print(json.dumps({"source": row["source"], "status": row["status"],
                              "httpStatus": row.get("httpStatus"),
                              "errorType": row.get("errorType"),
                              "count": row.get("count")}), flush=True)
    (outdir / "receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    if network and receipt["status"] != "CAPTURED":
        raise RuntimeError("Shadow capture incomplete; no production publication")
    return receipt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--week", type=int, default=10)
    ap.add_argument("--cbb-team", default="Duke")
    ap.add_argument("--outdir", default="artifacts/github-college-shadow")
    ap.add_argument("--network", action="store_true")
    a = ap.parse_args()
    report = capture(Path(a.outdir), a.year, a.week, a.cbb_team, a.network)
    print(json.dumps({"status": report["status"], "sourceCount": len(report["sources"]), "productionAuthority": False}))


if __name__ == "__main__":
    main()
