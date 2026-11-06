import unittest
from scripts.github_college_coverage import PROBES, MAX_CALLS, ids_and_fields, shape_summary, verdict

class CoverageContractTests(unittest.TestCase):
    def test_bounded_requests_and_season_convention(self):
        self.assertEqual(len(PROBES), MAX_CALLS)
        self.assertLessEqual(MAX_CALLS, 16)
        self.assertEqual(next(p for p in PROBES if p[1]=="division_directory")[3]["season"], 2027)
        self.assertTrue(all(p[2].startswith("/") and p[0] in ("cfbd","cbbd") for p in PROBES))

    def test_directory_requires_envelope(self):
        rows, ext = shape_summary({"teams":[{"id":1},{"id":2}],"season":2027,"conferences":[{"id":3}]}, "directory_object")
        self.assertEqual(len(rows), 2)
        self.assertEqual(ext["conferences"], 1)
        with self.assertRaises(ValueError):
            shape_summary([{"id":1}], "directory_object")

    def test_duplicate_and_missing_identifiers(self):
        r = ids_and_fields([{"id":1},{"id":1},{"id":None},{}], "games")
        self.assertEqual(r["duplicateIds"], 1)
        self.assertEqual(r["missingIds"], 2)

    def test_missing_data_not_reported_as_complete(self):
        self.assertEqual(verdict([{"status":"RESPONSE_OBSERVED"},{"status":"EMPTY_NOT_ZERO"}]), "PARTIAL_DATA")
        self.assertEqual(verdict([{"status":"ERROR"}]), "BLOCKED")
        self.assertEqual(verdict([{"status":"RESPONSE_OBSERVED"}]), "SAMPLE_VERIFIED_FULL_COVERAGE_UNPROVEN")

if __name__ == "__main__":
    unittest.main()
