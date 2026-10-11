import csv
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "sdv", Path(__file__).resolve().parents[1] / "scripts" / "cfb-sdv-historical-collect.py"
)
sdv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sdv)

SCHEDULE = [
    {"game_id":"10001","season":"2024","start_date":"2024-09-01T15:00:00Z",
     "home_id":"101","away_id":"102","home_division":"fbs","away_division":"fbs",
     "completed":"TRUE","home_points":"20","away_points":"10"},
    {"game_id":"10002","season":"2024","start_date":"2024-09-09T15:00:00Z",
     "home_id":"102","away_id":"101","home_division":"fbs","away_division":"fbs",
     "completed":"TRUE","home_points":"17","away_points":"15"},
    {"game_id":"10003","season":"2024","start_date":"2024-09-16T15:00:00Z",
     "home_id":"101","away_id":"103","home_division":"fbs","away_division":"fcs",
     "completed":"TRUE","home_points":"30","away_points":"0"},
]
ADV = [
    {"game_id":"10001","season":"2024","team_id":"101","opponent_id":"102",
     "is_home":"TRUE","points_for":"20","points_against":"10","EPA_passing_per_play":"0.19"},
    {"game_id":"10001","season":"2024","team_id":"102","opponent_id":"101",
     "is_home":"FALSE","points_for":"10","points_against":"20","EPA_passing_per_play":"-0.13"},
    {"game_id":"10002","season":"2024","team_id":"102","opponent_id":"101",
     "is_home":"TRUE","points_for":"17","points_against":"15","EPA_passing_per_play":"0.18"},
    {"game_id":"10002","season":"2024","team_id":"101","opponent_id":"102",
     "is_home":"FALSE","points_for":"15","points_against":"17","EPA_passing_per_play":"0.40"},
    {"game_id":"10003","season":"2024","team_id":"101","opponent_id":"103",
     "is_home":"TRUE","points_for":"30","points_against":"0","EPA_passing_per_play":"0.50"},
]

class TestSdvHistorical(unittest.TestCase):
    def setUp(self):
        self.games, self.rejects = sdv.parse_schedule(SCHEDULE, 2024)

    def test_only_fbs_vs_fbs(self):
        self.assertEqual(len(self.games), 2)
        self.assertEqual(self.rejects["not_fbs_vs_fbs"], 1)

    def test_exact_identity_and_scores(self):
        cols = [v["name"] for v in sdv.numeric_catalog(ADV)]
        rows, rejects, stats = sdv.match_advanced(ADV, self.games, 2024, cols)
        self.assertEqual(len(rows), 4)
        self.assertEqual(stats["paired_fbs_games"], 2)
        self.assertEqual(rejects["not_verified_fbs_final"], 1)
        self.assertTrue(all(not r["can_influence_projection"] for r in rows))
        self.assertTrue(all(not r["source_publication_verified"] for r in rows))
        self.assertTrue(all("points_for" not in r["metrics"] for r in rows))

    def test_score_mismatch_quarantines_full_game(self):
        bad = [dict(r) for r in ADV]
        bad[0]["points_for"] = "99"
        rows, rejects, stats = sdv.match_advanced(
            bad, self.games, 2024, ["EPA_passing_per_play"]
        )
        self.assertEqual(rejects["result_score_conflict"], 1)
        self.assertEqual(stats["paired_fbs_games"], 1)
        self.assertEqual(len(rows), 2)

    def test_duplicate_team_game_fails(self):
        with self.assertRaisesRegex(ValueError, "Duplicate advanced"):
            sdv.match_advanced(
                ADV + [ADV[0]], self.games, 2024, ["EPA_passing_per_play"]
            )

    def test_wrong_canonical_player_team_key(self):
        bad = [dict(r) for r in ADV]
        bad[1]["team_id"] = "999"
        _, rejects, stats = sdv.match_advanced(
            bad, self.games, 2024, ["EPA_passing_per_play"]
        )
        self.assertEqual(rejects["team_identity_conflict"], 1)
        self.assertEqual(stats["paired_fbs_games"], 1)

    def test_schema_drift_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "schema has drifted"):
            sdv.parse_schedule([{k:v for k,v in r.items()
                                 if k != "home_division"} for r in SCHEDULE], 2024)

    def test_immutable_receipts(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            fixtures = root/"input"
            fixtures.mkdir()
            for kind, rows in [("schedule", SCHEDULE), ("advanced", ADV)]:
                with (fixtures / f"{kind}_2024.csv").open("w", newline="") as f:
                    writer = csv.DictWriter(f, fieldnames=list(rows[0]))
                    writer.writeheader()
                    writer.writerows(rows)
            out = root/"run"
            manifest = sdv.collect([2024], out, fixtures)
            self.assertEqual(manifest["seasons"]["2024"]["paired_fbs_games"], 2)
            self.assertFalse(manifest["pit_certified"])
            self.assertFalse(manifest["can_influence_projection"])
            self.assertIsNone(manifest["assets"][0]["original_publication_at"])
            with self.assertRaises(FileExistsError):
                sdv.collect([2024], out, fixtures)

if __name__ == "__main__":
    unittest.main()
