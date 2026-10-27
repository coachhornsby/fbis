import io
import json
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from archive_checked_download import download


class Response(io.BytesIO):
    def __init__(self, data, content_range, status=206):
        super().__init__(data)
        self.status = status
        self.headers = {'Content-Range': content_range}


class DownloadTest(unittest.TestCase):
    def opener(self, request, timeout):
        a, b = map(int, request.headers['Range'][6:].split('-'))
        return Response(b'abcdefghij'[a:b+1], f'bytes {a}-{b}/10')

    def test_resume_after_expired_url_keeps_complete_chunks(self):
        with tempfile.TemporaryDirectory() as d:
            calls = []
            def expires(request, timeout):
                if request.headers['Range'] == 'bytes=4-5':
                    raise PermissionError('HTTP 403 expired')
                return self.opener(request, timeout)
            with self.assertRaises(PermissionError):
                download('https://secret', 'snapshot-A', 10, d, 4, 2, expires)
            m = json.loads((Path(d)/'manifest.json').read_text())
            self.assertEqual(len(m['chunks']), 1)
            def resumed(request, timeout):
                calls.append(request.headers['Range'])
                return self.opener(request, timeout)
            result = download('https://new-secret', 'snapshot-A', 10, d, 4, 2, resumed)
            self.assertEqual(calls[0], 'bytes=4-5')
            self.assertFalse(result['deletion_ready'])
            self.assertEqual(result['state'], 'DOWNLOADED_NOT_RESTORE_VERIFIED')
            self.assertNotIn('secret', (Path(d)/'manifest.json').read_text())

    def test_truncation_never_commits_partial_chunk(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError, 'Truncated'):
                download('https://x', 'A', 10, d, 4, 2,
                         lambda *a, **k: Response(b'a', 'bytes 0-1/10'))
            self.assertEqual(list(Path(d).glob('*.gz')), [])
            self.assertEqual(json.loads((Path(d)/'manifest.json').read_text())['chunks'], [])

    def test_wrong_range_or_status_rejected(self):
        for response in [Response(b'ab', 'bytes 1-2/10'), Response(b'ab', 'bytes 0-1/10', 200)]:
            with tempfile.TemporaryDirectory() as d, self.assertRaises(ValueError):
                download('https://x', 'A', 10, d, 4, 2, lambda *a, **k: response)

    def test_different_snapshot_cannot_resume(self):
        with tempfile.TemporaryDirectory() as d:
            download('https://x', 'A', 10, d, 4, 2, self.opener)
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                download('https://x', 'B', 10, d, 4, 2, self.opener)

    def test_corruption_cannot_resume(self):
        with tempfile.TemporaryDirectory() as d:
            download('https://x', 'A', 10, d, 4, 2, self.opener)
            (Path(d)/'part-00000.sql.gz').write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'corrupt'):
                download('https://x', 'A', 10, d, 4, 2, self.opener)


if __name__ == '__main__':
    unittest.main()
