import json
import tempfile
import unittest
from pathlib import Path
from scripts.github_college_shadow import capture, jobs, validate


class GitHubCollegeShadowTest(unittest.TestCase):
    def test_dry_run_never_requires_keys(self):
        with tempfile.TemporaryDirectory() as d:
            report = capture(Path(d), 2026, 10, "Duke", False)
            self.assertEqual(report["status"], "DRY_RUN_NO_NETWORK")
            self.assertFalse(report["productionAuthority"])
            self.assertFalse(report["promotionAllowed"])
            self.assertEqual(report["cloudflareWrites"], 0)
            self.assertFalse((Path(d) / "cfbd.json").exists())
            self.assertTrue((Path(d) / "receipt.json").exists())

    def test_season_and_bounded_scope(self):
        js = jobs(2026, 10, "Duke")
        self.assertEqual(js[0][2]["year"], "2026")
        self.assertEqual(js[1][2]["season"], "2027")
        self.assertEqual(js[1][2]["team"], "Duke")

    def test_validation_rejects_unbounded_filters(self):
        for year, week, team in [(2019, 1, "Duke"), (2026, 21, "Duke"), (2026, 10, ""), (2026, 10, "X" * 71)]:
            with self.assertRaises(ValueError):
                validate(year, week, team)


if __name__ == "__main__":
    unittest.main()
