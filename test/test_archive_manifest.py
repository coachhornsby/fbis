"""Offline fake-Drive regressions: never constructs authenticated clients."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from archive_manifest import encode, save_batch_manifest, stable_manifest


class FakeDrive:
    def __init__(self):
        self.files = []
        self.data = {}
        self.writes = 0
        self.page_token = None

    def request(self, method, url, **kwargs):
        assert method == 'GET'
        assert kwargs['params']['pageSize'] == 100
        result = {'files': self.files, 'nextPageToken': self.page_token}
        return type('Response', (), {'json': lambda _: result})()

    def read(self, item):
        return self.data[item]

    def save_immutable(self, parent, name, payload):
        self.writes += 1
        item = str(self.writes)
        self.files.append({'id': item, 'name': name, 'mimeType': 'application/json', 'parents': [parent], 'trashed': False})
        self.data[item] = payload
        return item, 'created_verified'


class ManifestTest(unittest.TestCase):
    def manifest(self, collection, status='created_verified'):
        return {'contract': 'v1', 'productionAuthority': False, collection: [
            {'sha256': 'abc', 'driveId': 'original-id', 'sourceBytes': 3, 'status': status},
            {'sha256': 'def', 'driveId': 'other-id', 'sourceBytes': 5, 'status': 'existing_verified'}]}

    def save(self, drive, manifest, collection):
        return save_batch_manifest(drive, 'catalog', 'batch-', manifest, collection)

    def seed(self, drive, manifest):
        data = encode(manifest)
        return drive.save_immutable('catalog', 'batch-' + hashlib.sha256(data).hexdigest() + '.json', data)

    def test_new_and_repeated_runs_have_one_stable_manifest(self):
        for collection in ('files', 'objects'):
            with self.subTest(collection=collection):
                drive = FakeDrive()
                original = self.manifest(collection)
                self.assertEqual(self.save(drive, original, collection), ('1', 'created_verified'))
                self.assertIn('status', original[collection][0])  # receipts remain truthful
                self.assertNotIn('status', json.loads(drive.data['1'])[collection][0])
                self.assertEqual(self.save(drive, self.manifest(collection, 'existing_verified'), collection), ('1', 'existing_verified'))
                self.assertEqual(drive.writes, 1)

    def test_legacy_mixed_status_is_reused_without_rewrite(self):
        for collection in ('files', 'objects'):
            drive = FakeDrive()
            self.seed(drive, self.manifest(collection))
            before = copy.deepcopy(drive.data)
            self.assertEqual(self.save(drive, self.manifest(collection, 'existing_verified'), collection), ('1', 'existing_verified'))
            self.assertEqual(drive.data, before)
            self.assertEqual(drive.writes, 1)

    def test_semantic_changes_fail_without_writes(self):
        for key, value in [('sha256', 'changed'), ('driveId', 'changed'), ('sourceBytes', 99)]:
            drive = FakeDrive()
            original = self.manifest('files')
            self.seed(drive, original)
            original['files'][0][key] = value
            with self.assertRaisesRegex(RuntimeError, 'COLLISION'):
                self.save(drive, original, 'files')
            self.assertEqual(drive.writes, 1)
        drive = FakeDrive()
        original = self.manifest('files')
        self.seed(drive, original)
        original['productionAuthority'] = True
        with self.assertRaisesRegex(RuntimeError, 'COLLISION'):
            self.save(drive, original, 'files')

    def test_duplicates_truncation_corruption_and_metadata_fail_closed(self):
        for failure in ('duplicate', 'pagination', 'hash', 'type', 'parent', 'trashed'):
            with self.subTest(failure=failure):
                drive = FakeDrive()
                original = self.manifest('files')
                self.seed(drive, original)
                if failure == 'duplicate': drive.files.append(dict(drive.files[0]))
                if failure == 'pagination': drive.page_token = 'more'
                if failure == 'hash': drive.data['1'] += b' '
                if failure == 'type': drive.files[0]['mimeType'] = 'text/plain'
                if failure == 'parent': drive.files[0]['parents'] = ['elsewhere']
                if failure == 'trashed': drive.files[0]['trashed'] = True
                with self.assertRaises(RuntimeError): self.save(drive, original, 'files')
                self.assertEqual(drive.writes, 1)

    def test_unknown_status_not_silently_ignored(self):
        with self.assertRaisesRegex(RuntimeError, 'STATUS_INVALID'):
            stable_manifest(self.manifest('files', 'failed'), 'files')

    def test_all_three_writers_use_compatibility_helper(self):
        scripts = Path(__file__).resolve().parents[1] / 'scripts'
        for name in ('r2_multifile', 'r2_continuation', 'market_r2'):
            source = (scripts / ('fbis_drive_archive_' + name + '.py')).read_text()
            self.assertIn('from archive_manifest import save_batch_manifest', source)
            self.assertEqual(source.count('save_batch_manifest('), 1)


if __name__ == '__main__':
    unittest.main()
