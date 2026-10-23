#!/usr/bin/env python3
"""Acquire SDV football play-by-play as timestamped historical source evidence.

This is a collector, not a pregame recorder. Historical PBP retrieved today is
POSTGAME_RECONSTRUCTED, never immutable proof of data available before past games.
Offline extractor validates completed schedules and exports only fields required
to reconcile drives. Actual drive-level validation occurs in Node research code.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from zoneinfo import ZoneInfo

NFL_FIELDS = (
    "game_id","play_id","home_team","away_team","home_score","away_score",
    "posteam","defteam","qtr","game_half","drive","yardline_100",
    "total_home_score","total_away_score","posteam_score_post",
    "defteam_score_post","game_seconds_remaining","play_type"
)
CFB_FIELDS = (
    "game_id","game_play_number","drive.id","start.team.id",
    "homeTeamId","awayTeamId","homeTeamName","awayTeamName",
    "homeFinalScore","awayFinalScore","homeScore","awayScore",
    "period.number","drive.start.period.number","start.yardsToEndzone",
    "drive.offensivePlays","drive.result","status_type_completed",
    "start_time","season","week"
)
NFL_SOURCE = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet"
CFB_SOURCE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_pbp/play_by_play_{season}.parquet"


def iso(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def frame_rows(frame, columns):
    # Polars (the documented SDV default), bounded to needed fields.
    if hasattr(frame, "select"):
        available = [c for c in columns if c in frame.columns]
        for row in frame.select(available).iter_rows(named=True):
            yield {k: (None if isinstance(v,float) and not math.isfinite(v) else iso(v) if isinstance(v, datetime) else v) for k, v in row.items()}
    else:
        for row in frame.to_dict("records"):
            yield {k: row.get(k) for k in columns if k in row}


def nfl_kickoff(s):
    date, hour = s.get("gameday"), s.get("gametime")
    if not date or not hour:
        return None
    try:
        from datetime import datetime as D
        local = D.fromisoformat(f"{date}T{hour}")
        if local.tzinfo is None:
            local = local.replace(tzinfo=ZoneInfo("America/New_York"))
        return local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", nargs="+", type=int, default=[2024, 2025, 2026])
    parser.add_argument("--sports", nargs="+", choices=("nfl","cfb"), default=["nfl","cfb"])
    parser.add_argument("--out", default="artifacts/football-sdv")
    args = parser.parse_args()
    import sportsdataverse as sdv
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
    manifest = {"source": "sportsdataverse-py", "observedAt":observed_at,
       "historicalEvidence":"POSTGAME_RECONSTRUCTED", "prospective":False,
       "canAuthorizeWager":False, "seasonRuns":[], "errors":[]}
    total = 0
    for sport in args.sports:
        for season in args.seasons:
            if season < 2020 or season > datetime.now(timezone.utc).year:
                raise ValueError("SEASON_OUT_OF_BOUNDS")
            try:
                if sport == "nfl":
                    pbp = sdv.nfl.load_nfl_pbp(seasons=[season])
                    schedule = sdv.nfl.load_nfl_schedule(seasons=[season])
                    source = NFL_SOURCE.format(season=season)
                    sched = {str(r["game_id"]):r for r in frame_rows(schedule,("game_id","gameday","gametime",
                          "home_score","away_score","game_type","spread_line","total_line")) if r.get("game_id") is not None}
                    fields = NFL_FIELDS
                else:
                    pbp = sdv.cfb.load_cfb_pbp(seasons=[season])
                    schedule = sdv.cfb.load_cfb_schedule(seasons=[season])
                    source = CFB_SOURCE.format(season=season)
                    sched = {str(r["game_id"]):r for r in frame_rows(schedule,("game_id","start_date",
                          "start_time_tbd","season_type","home_points","away_points"))
                          if r.get("game_id") is not None}
                    fields = CFB_FIELDS
                games = defaultdict(list)
                for r in frame_rows(pbp,fields):
                    gid = r.get("game_id")
                    if gid is not None:
                        games[str(gid)].append(r)
                path = out / f"{sport}-{season}-games.jsonl"
                selected = 0
                skipped = defaultdict(int)
                sha = hashlib.sha256()
                with path.open("w",encoding="utf8") as f:
                    for gid, plays in sorted(games.items()):
                        s = sched.get(gid)
                        if not s:
                            skipped["NO_SCHEDULE"]=skipped["NO_SCHEDULE"]+1
                            continue
                        if sport == "nfl":
                            kickoff=nfl_kickoff(s)
                            if str(s.get("game_type") or "").upper() not in ("REG","WC","DIV","CON","SB"):
                                skipped["NON_STANDARD_GAME"]=skipped["NON_STANDARD_GAME"]+1
                                continue
                        else:
                            kickoff=iso(s.get("start_date"))
                            if s.get("start_time_tbd") or str(s.get("season_type") or "").lower() not in ("regular","postseason"):
                                skipped["UNVERIFIED_KICKOFF"]=skipped["UNVERIFIED_KICKOFF"]+1
                                continue
                        try:
                            if kickoff is None or datetime.fromisoformat(kickoff.replace("Z","+00:00")) >= datetime.fromisoformat(observed_at.replace("Z","+00:00")):
                                skipped["NOT_HISTORICAL_FINAL"]=skipped["NOT_HISTORICAL_FINAL"]+1
                                continue
                        except ValueError:
                            skipped["INVALID_SCHEDULE_CLOCK"]=skipped["INVALID_SCHEDULE_CLOCK"]+1
                            continue
                        # Dataset timestamps are collection clocks, never backdated to past games.
                        market_reference = None
                        if sport == "nfl":
                            spread, total = s.get("spread_line"), s.get("total_line")
                            if isinstance(spread,(float,int)) and isinstance(total,(float,int)) and math.isfinite(spread) and math.isfinite(total) and 20 <= total <= 90:
                                market_reference = {"homeMargin": float(spread), "total": float(total),
                                  "source": "NFLVERSE_PFR_HISTORICAL_CLOSING", "asOf": None, "prospective": False}
                        obj={"sport":sport,"season":season,"gameId":gid,"kickoff":kickoff,
                             "marketReference":market_reference,
                             "observedAt":observed_at,"gradedAt":observed_at,
                             "sourceAsset":source,"evidenceClass":"RECONSTRUCTED_HISTORICAL",
                             "sourceRows":plays}
                        raw=json.dumps(obj,separators=(",",":"),sort_keys=True,default=str)
                        sha.update((raw+"\n").encode())
                        f.write(raw+"\n")
                        selected+=1
                manifest["seasonRuns"].append({"sport":sport,"season":season,"games":selected,
                    "sourceAsset":source,"file":str(path),"sha256":sha.hexdigest(),
                    "skipped":dict(skipped)})
                total+=selected
                print(f"{sport} {season}: {selected} scheduled games, {len(games)} PBP games",flush=True)
            except Exception as e:
                manifest["errors"].append({"sport":sport,"season":season,"error":str(e)[:240]})
                print(f"{sport} {season}: {type(e).__name__}: {e}",flush=True)
    manifest["scheduledGames"]=total
    (out/"acquisition-manifest.json").write_text(json.dumps(manifest,indent=2))
    if total==0:
        raise SystemExit("NO_VERIFIED_SDV_SCHEDULE_AND_PBP_PAIRS")

if __name__=="__main__":
    main()
