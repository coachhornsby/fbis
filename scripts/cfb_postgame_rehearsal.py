"""Offline transaction/reference implementation. Never opens remote storage.

Production adapter, scheduler activation, source licensing and D1 load qualification
remain release gates. Explicit canonical identities are required from the caller.
"""
import hashlib
import json
import math
import sqlite3
from datetime import datetime, timezone


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def stamp(value):
    d = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if d.tzinfo is None:
        raise ValueError("timezone required")
    return d.astimezone(timezone.utc)


SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs(game_id TEXT PRIMARY KEY,state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,error TEXT,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS raw_evidence(hash TEXT PRIMARY KEY,body TEXT NOT NULL,
  acquired_at TEXT NOT NULL,source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS game_versions(id TEXT PRIMARY KEY,game_id TEXT NOT NULL,
  season INTEGER NOT NULL,game_at TEXT NOT NULL,observed_at TEXT NOT NULL,
  evidence_hash TEXT NOT NULL REFERENCES raw_evidence(hash),body TEXT NOT NULL,committed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS game_versions_pit ON game_versions(game_id,observed_at);
CREATE TABLE IF NOT EXISTS current_games(game_id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES game_versions(id));
CREATE TABLE IF NOT EXISTS card_versions(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,
  season INTEGER NOT NULL,published_at TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS current_cards(team_id TEXT NOT NULL,season INTEGER NOT NULL,
  version_id TEXT NOT NULL REFERENCES card_versions(id),PRIMARY KEY(team_id,season));
CREATE TABLE IF NOT EXISTS pregame_snapshots(id TEXT PRIMARY KEY,game_id TEXT NOT NULL,
  cutoff TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refresh_outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,
  version_id TEXT NOT NULL,payload TEXT NOT NULL,completed_at TEXT);
"""

# Rates, percentages and maxima must not be summed. Extend only with a contract.
ADDITIVE = frozenset({"points", "plays", "yards", "rushes", "rush_yards",
    "pass_attempts", "completions", "pass_yards", "sacks", "turnovers",
    "penalties", "penalty_yards", "third_attempts", "third_conversions",
    "fourth_attempts", "fourth_conversions", "redzone_attempts", "redzone_scores",
    "explosive_plays", "punts", "punt_yards", "field_goal_attempts",
    "field_goals", "receptions", "tackles", "touchdowns", "epa_total"})


def aggregate(records):
    keys = sorted(set().union(*(r.keys() for r in records))) if records else []
    result = {}
    for key in keys:
        values = [r[key] for r in records if r.get(key) is not None]
        result[key] = {"games": len(values), "total": sum(values) if values and key in ADDITIVE else None,
                       "mean": sum(values) / len(values) if values else None,
                       "aggregation": "additive" if key in ADDITIVE else "mean_of_available_game_values"}
    for name, numerator, denominator in [("yards_per_play", "yards", "plays"),
        ("completion_rate", "completions", "pass_attempts"),
        ("third_down_rate", "third_conversions", "third_attempts"),
        ("epa_per_play", "epa_total", "plays")]:
        pairs = [(r[numerator], r[denominator]) for r in records
                 if r.get(numerator) is not None and r.get(denominator) is not None]
        denom = sum(p[1] for p in pairs)
        result[name] = {"games": len(pairs), "value": sum(p[0] for p in pairs)/denom if denom else None,
                        "aggregation": "ratio_of_paired_totals"}
    return result


class Ledger:
    def __init__(self, path=":memory:"):
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA)
        if "committed_at" not in {r[1] for r in self.db.execute("PRAGMA table_info(game_versions)")}:
            # Old local rehearsal versions remain unavailable for PIT; never backdate commit clocks.
            self.db.execute("ALTER TABLE game_versions ADD COLUMN committed_at TEXT")
            self.db.commit()

    def state(self, game_id, state, at, error=None):
        with self.db:
            self.db.execute("INSERT INTO jobs VALUES(?,?,1,?,?) ON CONFLICT(game_id) DO UPDATE SET "
                "state=excluded.state,attempts=jobs.attempts+1,error=excluded.error,updated_at=excluded.updated_at",
                (game_id, state, error, at))

    def discover(self, game, at):
        stamp(at)
        state = {"SCHEDULED": "SCHEDULED", "IN_PROGRESS": "IN_PROGRESS", "FINAL": "FINAL_DETECTED",
                 "CANCELLED": "CANCELLED", "POSTPONED": "POSTPONED", "SUSPENDED": "SUSPENDED"}.get(game["status"])
        if state is None:
            raise ValueError("unknown status; official result review required")
        # Duplicate discovery must not regress a reconciled game.
        row = self.db.execute("SELECT state FROM jobs WHERE game_id=?", (game["game_id"],)).fetchone()
        if not row or row[0] not in {"VERIFIED", "CORRECTED"}:
            self.state(game["game_id"], state, at)
        return state

    def validate(self, payload, directory, memberships, at):
        if payload["status"] != "FINAL":
            raise ValueError("not authoritative final")
        if not payload.get("source") or not payload.get("provider_game_id"):
            raise ValueError("missing source identity")
        game_at, observed, processed = stamp(payload["game_at"]), stamp(payload["observed_at"]), stamp(at)
        if not game_at < observed <= processed:
            raise ValueError("invalid source chronology")
        if payload.get("provider_final_at") and not game_at <= stamp(payload["provider_final_at"]) <= observed:
            raise ValueError("invalid final timestamp")
        if payload.get("source_available_at") and stamp(payload["source_available_at"]) > observed:
            raise ValueError("source not available at acquisition")
        if payload.get("temporal_class") not in {"POSTGAME_OBSERVED", "RETROSPECTIVE"}:
            raise ValueError("explicit temporal class required")
        teams = payload["teams"]
        if len(teams) != 2 or {t["side"] for t in teams} != {"home", "away"} or len({t["team_id"] for t in teams}) != 2:
            raise ValueError("exactly two distinct oriented teams required")
        scope = []
        for team in teams:
            identity = directory.get((team["team_id"], payload["season"]))
            if not identity or identity["provider_id"] != team["provider_team_id"]:
                raise ValueError("canonical team/provider identity mismatch")
            scope.append(identity["classification"])
            score = team["metrics"].get("points")
            if isinstance(score, bool) or not isinstance(score, int) or score < 0 or score != payload["scores"][team["side"]]:
                raise ValueError("score reconciliation failed")
            if team.get("team_complete") is not True or team.get("player_complete") is not True:
                raise LookupError("partial team/player source")
            seen = set()
            for player in team["players"]:
                pid = player["player_id"]
                if pid in seen:
                    raise ValueError("duplicate player rows")
                seen.add(pid)
                members = memberships.get((pid, team["team_id"], payload["season"]), [])
                if not any(m["provider_id"] == player["provider_player_id"] and
                           stamp(m["from"]) <= game_at < stamp(m["to"]) for m in members):
                    raise ValueError("invalid time-aware player membership")
                if player.get("participated") is not True:
                    raise ValueError("roster is not participation evidence")
            for metrics in [team["metrics"]] + [p["metrics"] for p in team["players"]]:
                for name, value in metrics.items():
                    if value is not None and (isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value)):
                        raise ValueError("invalid numeric statistic")
                for made, attempts in [("completions", "pass_attempts"), ("third_conversions", "third_attempts"),
                    ("fourth_conversions", "fourth_attempts"), ("field_goals", "field_goal_attempts")]:
                    if metrics.get(made) is not None and metrics.get(attempts) is not None and not 0 <= metrics[made] <= metrics[attempts]:
                        raise ValueError("statistic exceeds attempts")
        if "FBS" not in scope:
            raise ValueError("not an FBS-involving game")
        # No player/team additive equivalence is assumed across differing sack and yard conventions.
        return True

    def _games(self):
        return [(vid, json.loads(body)) for vid, body in self.db.execute(
            "SELECT v.id,v.body FROM current_games c JOIN game_versions v ON v.id=c.version_id")]

    def _card(self, team_id, season):
        games = [(v, g, t) for v, g in self._games() if g["season"] == season
                 for t in g["teams"] if t["team_id"] == team_id]
        games.sort(key=lambda x: (stamp(x[1]["game_at"]), x[1]["game_id"]))
        wins = losses = ties = 0
        players = {}
        defenses = []
        for vid, g, t in games:
            other = next(o for o in g["teams"] if o["team_id"] != team_id)
            diff = t["metrics"]["points"] - other["metrics"]["points"]
            wins += diff > 0; losses += diff < 0; ties += diff == 0
            defenses.append(other["metrics"])
            for p in t["players"]:
                players.setdefault(p["player_id"], []).append(p["metrics"])
        return {"team_id": team_id, "season": season, "games": len(games),
            "record": {"wins": wins, "losses": losses, "ties": ties},
            "offense": aggregate([t["metrics"] for _, _, t in games]), "defense": aggregate(defenses),
            "rolling5": aggregate([t["metrics"] for _, _, t in games[-5:]]),
            "players": {p: aggregate(rows) for p, rows in sorted(players.items())},
            "game_versions": [v for v, _, _ in games], "coverage": "source_declared_complete",
            "opponent_adjusted": None, "model_authority": False, "wager_authority": False}

    def process(self, payload, directory, memberships, at, fail_at=None):
        game_id = payload["game_id"]
        stamp(at); stamp(payload["observed_at"])
        # Preserve rejected original evidence too. Acquisition time is outside the content hash.
        raw_hash = digest(payload)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO raw_evidence VALUES(?,?,?,?)",
                (raw_hash, encode(payload), payload["observed_at"], payload.get("source", "UNKNOWN")))
        self.state(game_id, "VALIDATING", at)
        try:
            self.validate(payload, directory, memberships, at)
            current = self.db.execute("SELECT version_id FROM current_games WHERE game_id=?", (game_id,)).fetchone()
            # Content identity excludes retrieval clocks; re-polling identical evidence is a no-op.
            normalized = {k: v for k, v in payload.items() if k not in {"observed_at", "source_available_at", "provider_final_at"}}
            version = digest(normalized)
            if current and current[0] == version:
                self.state(game_id, "VERIFIED", at)
                return version
            if self.db.execute("SELECT 1 FROM game_versions WHERE id=?", (version,)).fetchone():
                raise ValueError("old source version replay would regress correction")
            if current:
                old = self.db.execute("SELECT observed_at,body FROM game_versions WHERE id=?", current).fetchone()
                if stamp(payload["observed_at"]) <= stamp(old[0]):
                    raise ValueError("non-monotonic correction observation")
                prior = json.loads(old[1])
                if (prior["season"], prior["game_at"], {t["team_id"] for t in prior["teams"]}) != (
                    payload["season"], payload["game_at"], {t["team_id"] for t in payload["teams"]}):
                    raise ValueError("correction changed game identity")
            with self.db:
                self.db.execute("INSERT INTO game_versions VALUES(?,?,?,?,?,?,?,?)",
                    (version, game_id, payload["season"], payload["game_at"], payload["observed_at"], raw_hash, encode(payload), at))
                self.db.execute("INSERT INTO current_games VALUES(?,?) ON CONFLICT(game_id) DO UPDATE SET version_id=excluded.version_id",
                    (game_id, version))
                for index, team in enumerate(payload["teams"]):
                    card = self._card(team["team_id"], payload["season"])
                    cid = digest(card)
                    self.db.execute("INSERT OR IGNORE INTO card_versions VALUES(?,?,?,?,?)",
                        (cid, team["team_id"], payload["season"], at, encode(card)))
                    self.db.execute("INSERT INTO current_cards VALUES(?,?,?) ON CONFLICT(team_id,season) DO UPDATE SET version_id=excluded.version_id",
                        (team["team_id"], payload["season"], cid))
                    if fail_at == index:
                        raise OSError("injected transaction failure")
                for kind in ("CACHE_INVALIDATION", "MODEL_STATE_RESEARCH_REFRESH", "DEPENDENT_RATINGS_RECOMPUTE"):
                    self.db.execute("INSERT INTO refresh_outbox VALUES(?,?,?,?,NULL)",
                        (digest([version, kind]), kind, version, encode({"game_id": game_id, "teams": [t["team_id"] for t in payload["teams"]]})))
                self.db.execute("UPDATE jobs SET state=?,error=NULL,updated_at=? WHERE game_id=?",
                    ("CORRECTED" if current else "VERIFIED", at, game_id))
            return version
        except Exception as error:
            state = "PARTIAL_SOURCE" if isinstance(error, LookupError) else "QUARANTINED" if isinstance(error, ValueError) else "RETRY_PENDING"
            self.state(game_id, state, at, str(error))
            raise

    def snapshot(self, game_id, teams, season, cutoff, kickoff):
        if not stamp(cutoff) < stamp(kickoff):
            raise ValueError("decision cutoff must precede kickoff")
        # Select latest acquired version *as of* cutoff, never current pointers.
        candidates = {}
        for vid, gid, observed, body, committed in self.db.execute("SELECT id,game_id,observed_at,body,committed_at FROM game_versions"):
            p = json.loads(body)
            if committed is None or stamp(committed) > stamp(cutoff) or p["temporal_class"] != "POSTGAME_OBSERVED" or stamp(observed) > stamp(cutoff) or stamp(p["game_at"]) >= stamp(cutoff):
                continue
            if gid not in candidates or stamp(observed) > stamp(candidates[gid][1]):
                candidates[gid] = (vid, observed, p)
        body = {"game_id": game_id, "cutoff": cutoff, "kickoff": kickoff, "season": season,
            "teams": teams, "game_versions": sorted(v for v, _, p in candidates.values()
                if p["season"] == season and any(t["team_id"] in teams for t in p["teams"])),
            "model_authority": False, "wager_authority": False}
        body["team_state"] = {}
        for team_id in teams:
            own=[];opponents=[]
            for _,_,p in candidates.values():
                if p["season"]!=season:continue
                team=next((t for t in p["teams"] if t["team_id"]==team_id),None)
                if team is not None:
                    own.append(team["metrics"])
                    opponents.append(next(t["metrics"] for t in p["teams"] if t["team_id"]!=team_id))
            body["team_state"][team_id]={"games":len(own),"offense":aggregate(own),"defense":aggregate(opponents)}
        sid = digest(body)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO pregame_snapshots VALUES(?,?,?,?)", (sid, game_id, cutoff, encode(body)))
        return sid, body

    def health(self):
        states = dict(self.db.execute("SELECT state,COUNT(*) FROM jobs GROUP BY state"))
        missing = self.db.execute("SELECT COUNT(*) FROM current_games c JOIN game_versions v ON v.id=c.version_id "
            "WHERE (SELECT COUNT(*) FROM current_cards p WHERE p.season=v.season AND EXISTS "
            "(SELECT 1 FROM json_each(v.body,'$.teams') t WHERE json_extract(t.value,'$.team_id')=p.team_id))<>2").fetchone()[0]
        return {"states": states, "missing_card_pairs": missing,
            "pending_outbox": self.db.execute("SELECT COUNT(*) FROM refresh_outbox WHERE completed_at IS NULL").fetchone()[0],
            "production_ready": False}
