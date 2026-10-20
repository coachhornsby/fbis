"""Synthetic-only tests for SDV NBA research normalization (no network required)."""
import importlib.util
import unittest
from datetime import date
from pathlib import Path

script = Path(__file__).resolve().parents[1] / "scripts" / "sdv-nba-last5-shadow.py"
spec = importlib.util.spec_from_file_location("sdv_nba_history", script)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def row(athlete="4684742", game="401898843", day="2026-04-10", season_type=2,
        points=18, minutes=30):
    return {"athlete_id": athlete, "game_id": game, "game_date": day, "season": 2026,
            "season_type": season_type, "minutes": minutes, "points": points,
            "rebounds": 7, "assists": 5, "three_point_field_goals_made": 2,
            "did_not_play": False}

class NbaSdvHistoryTest(unittest.TestCase):
    def test_only_pregame_regular_season_stats(self):
        games = [row(day="2026-04-10"), row(game="401898844", day="2026-10-20"),
                 row(game="401898845", season_type=1),
                 row(game="401898846", minutes=0),
                 row(game="401898847", points=105)]
        result = mod.normalize(games, date(2026, 10, 20))
        self.assertEqual(len(result), 1)
        self.assertEqual(len(result[0]["games"]), 1)
        self.assertEqual(result[0]["games"][0]["points"], 18)

    def test_last_five_are_deduplicated_and_sorted(self):
        games = [row(game=str(401898840+i), day=f"2026-04-{i+10:02d}", points=10+i)
                 for i in range(8)]
        games.append(row(game="401898847", day="2026-04-17", points=17))
        result = mod.normalize(games, date(2026, 10, 20))
        self.assertEqual([g["points"] for g in result[0]["games"]], [17,16,15,14,13])
        self.assertEqual(len(result[0]["games"]), 5)

    def test_canonical_espn_id_and_no_model_authority(self):
        payload = mod.create_snapshot([row()], date(2026, 10, 20),
                                      generated_at="2026-10-20T13:00:00Z")
        self.assertEqual(payload["entries"][0]["espnPlayerId"], "4684742")
        self.assertFalse(payload["canAuthorizeWager"])
        self.assertFalse(payload["canQualify"])
        self.assertEqual(payload["mode"], "SHADOW_RESEARCH_ONLY")
        self.assertEqual(payload["seasonType"], "NBA_REGULAR_SEASON_ONLY")

if __name__ == "__main__":
    unittest.main()
