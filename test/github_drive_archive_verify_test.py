import hashlib
import io
import json
import tarfile
import unittest
from scripts.github_drive_archive_verify import inspect_archive, SOURCES


def sample():
    content = b'private provider bytes'
    metadata = {"files": {"part.json": {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}}}
    b = io.BytesIO()
    with tarfile.open(fileobj=b, mode="w:gz") as tar:
        for name, data in [("part.json", content), ("archive-manifest.json", json.dumps(metadata).encode())]:
            ti = tarfile.TarInfo(name); ti.size = len(data)
            tar.addfile(ti, io.BytesIO(data))
    return b.getvalue()


class DriveArchiveTests(unittest.TestCase):
    def test_three_allowlisted_files(self):
        self.assertEqual(len(SOURCES), 3)

    def test_exact_manifest_pass(self):
        blob = sample()
        result = inspect_archive(blob, "test", hashlib.sha256(blob).hexdigest(), "archive-manifest.json")
        self.assertEqual(result["memberCount"], 1)

    def test_corruption_fails_closed(self):
        blob = sample()
        with self.assertRaisesRegex(ValueError, "ARCHIVE_SHA256_MISMATCH"):
            inspect_archive(blob, "test", "0"*64, "archive-manifest.json")

    def test_missing_manifest_rejected(self):
        blob = sample()
        with self.assertRaisesRegex(ValueError, "MISSING_INTERNAL_MANIFEST"):
            inspect_archive(blob, "test", hashlib.sha256(blob).hexdigest(), "missing.json")


if __name__ == "__main__":
    unittest.main()
