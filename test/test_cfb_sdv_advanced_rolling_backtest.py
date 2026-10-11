import importlib.util
from pathlib import Path
import unittest
import numpy as np

path = Path(__file__).resolve().parents[1]/"scripts"/"cfb-sdv-advanced-rolling-backtest.py"
spec = importlib.util.spec_from_file_location("sdvbacktest", path)
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


def observation(game, team, opponent, is_home, metric, scored, conceded, kickoff):
    return {"game_id":str(game),"season":2024,"week":game,
            "team_id":str(team),"opponent_id":str(opponent),
            "is_home":is_home,"metrics":{"EPA_per_play":metric},
            "kickoff":kickoff,"final_score_for":scored,"final_score_against":conceded,
            "temporal_class":"POSTGAME_ONLY","can_influence_projection":False}


class TestHistoricalAdvancedLeakage(unittest.TestCase):
    def fixture(self):
        return [
            observation(1,101,102,True,200,20,10,"2024-09-01T15:00:00Z"),
            observation(1,102,101,False,-100,10,20,"2024-09-01T15:00:00Z"),
            observation(2,102,101,True,300,17,15,"2024-09-09T15:00:00Z"),
            observation(2,101,102,False,400,15,17,"2024-09-09T15:00:00Z"),
        ]

    def test_never_use_same_game_advanced_statistics(self):
        rows, names = study.make_retro_rows(self.fixture())
        self.assertEqual(len(rows), 2)
        self.assertTrue(np.isnan(rows[0]["x"][0]))
        self.assertTrue(np.isnan(rows[0]["x"][1]))
        self.assertEqual(rows[1]["x"][0], -100)
        self.assertEqual(rows[1]["x"][1], 200)
        self.assertNotIn(300, rows[1]["x"][:2])
        self.assertNotIn(400, rows[1]["x"][:2])

    def test_model_authority_contamination_fails(self):
        rows=self.fixture()
        rows[0]["can_influence_projection"]=True
        with self.assertRaisesRegex(ValueError,"unclassified/authorized"):
            study.make_retro_rows(rows)

    def test_final_score_conflict_fails(self):
        rows=self.fixture()
        rows[1]["final_score_for"]=999
        with self.assertRaisesRegex(ValueError,"Score pair mismatch"):
            study.make_retro_rows(rows)


if __name__ == "__main__":
    unittest.main()
