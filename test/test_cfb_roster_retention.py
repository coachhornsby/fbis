"""Pure retrospective source-routing regression tests; no provider requests."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from lib.cfb_roster_retention import (
    CFB_ROSTER_COLD_ARCHIVE_FULL_MANIFEST,
    RELEASED_RETROSPECTIVE_ROSTER_OBSERVATION_SEASONS,
    persist_d1_raw_roster_observation,
)


class RetentionTest(unittest.TestCase):
    def test_only_independently_verified_2004_observation_is_excluded(self):
        self.assertEqual(RELEASED_RETROSPECTIVE_ROSTER_OBSERVATION_SEASONS, frozenset({2004}))
        self.assertFalse(persist_d1_raw_roster_observation(2004))
        for season in (2005, 2008, 2018, 2024, 2025, 2026):
            self.assertTrue(persist_d1_raw_roster_observation(season))
        self.assertTrue(CFB_ROSTER_COLD_ARCHIVE_FULL_MANIFEST.endswith(
            "675ad4a9f3cb17a87f09acc577bd40f2e2f8e7e4ea59bf501df14b48b063aa8c.json"))

    def test_no_malformed_or_unsupported_cold_seasons(self):
        for bad in (None, "2004", False, True, 2003, 2027, 2004.5):
            with self.assertRaises(ValueError):
                persist_d1_raw_roster_observation(bad)


if __name__ == "__main__":
    unittest.main()
