"""Offline accounting fixtures. No credentials, network, Drive, or D1 required."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]

def fail(code):
    raise RuntimeError(code)

helper = types.ModuleType('fbis_drive_archive_pilot')
helper.Drive = Mock(side_effect=AssertionError('Drive prohibited'))
helper.ROOT = 'offline'
helper.digest = Mock()
helper.fail = fail
http = types.ModuleType('requests')
http.post = Mock(side_effect=AssertionError('Network prohibited'))
spec = importlib.util.spec_from_file_location('d1_pilot_under_test', ROOT / 'scripts/fbis_drive_archive_bounded_d1.py')
pilot = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'fbis_drive_archive_pilot': helper, 'requests': http}):
    spec.loader.exec_module(pilot)


def block(**overrides):
    meta = dict(rows_read=5, rows_written=0, changed_db=False, total_attempts=1)
    meta.update(overrides)
    return dict(success=True, meta=meta, results=[{'secret': 'DO_NOT_LOG'}])


class AccountingTests(unittest.TestCase):
    def validate(self, data, budget=1000):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            result = pilot.validate_accounting(data, 'sample', budget)
        self.assertNotIn('DO_NOT_LOG', out.getvalue())
        return result

    def test_exact_cap_and_zero_allowed(self):
        self.assertEqual(self.validate(block(rows_read=1000)), 1000)
        self.assertEqual(self.validate(block(rows_read=0)), 0)

    def test_unknown_and_malformed_reads_fail_closed(self):
        for value in (None, -1, True, False, '5', 5.5, {}, [], 'DO_NOT_LOG'):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, 'D1_ROW_READ_ACCOUNTING_UNKNOWN:sample'), contextlib.redirect_stdout(io.StringIO()) as out:
                pilot.validate_accounting(block(rows_read=value), 'sample', 1000)
            self.assertNotIn('DO_NOT_LOG', out.getvalue())

    def test_missing_reads_fail_closed(self):
        data = block(); del data['meta']['rows_read']
        with self.assertRaisesRegex(RuntimeError, 'ACCOUNTING_UNKNOWN'), contextlib.redirect_stdout(io.StringIO()):
            pilot.validate_accounting(data, 'schema', 1000)

    def test_over_budget_and_cumulative_budget(self):
        for rows, budget in [(1001, 1000), (600, 500)]:
            with self.assertRaisesRegex(RuntimeError, 'D1_ROW_READ_BUDGET_EXCEEDED:sample'), contextlib.redirect_stdout(io.StringIO()):
                pilot.validate_accounting(block(rows_read=rows), 'sample', budget)

    def test_mutation_accounting_must_be_explicit(self):
        for field, value in [('rows_written', None), ('rows_written', 1), ('rows_written', False), ('rows_written', '0'), ('changed_db', None), ('changed_db', True), ('changed_db', 0)]:
            with self.subTest(field=field, value=value), self.assertRaisesRegex(RuntimeError, 'MUTATION_ACCOUNTING_UNSAFE_OR_UNKNOWN'), contextlib.redirect_stdout(io.StringIO()):
                pilot.validate_accounting(block(**{field: value}), 'sample', 1000)

    def test_missing_meta_and_unsuccessful_result(self):
        for data, error in [({'success': True}, 'MUTATION'), ({'success': False, 'meta': block()['meta']}, 'NOT_SUCCESSFUL')]:
            with self.assertRaisesRegex(RuntimeError, error), contextlib.redirect_stdout(io.StringIO()):
                pilot.validate_accounting(data, 'schema', 1000)

    def test_preflight_rejects_sql_and_invalid_budget_without_network(self):
        http.post.reset_mock()
        for sql, budget in [('SELECT * FROM dangerous', 1000), (next(iter(pilot.STATEMENTS)), 0), (next(iter(pilot.STATEMENTS)), 1001), (next(iter(pilot.STATEMENTS)), True)]:
            with self.assertRaises(RuntimeError):
                pilot.cloudflare_query(sql, 'offline', 'DO_NOT_LOG', budget)
        http.post.assert_not_called()

    def test_mock_response_logs_label_and_never_retries(self):
        response = Mock(status_code=200)
        response.iter_content.return_value = [json.dumps({'success': True, 'result': [block(rows_read=1001)]}).encode()]
        manager = Mock(); manager.__enter__ = Mock(return_value=response); manager.__exit__ = Mock(return_value=False)
        with patch.object(http, 'post', return_value=manager) as post, contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaisesRegex(RuntimeError, 'EXCEEDED:schema'):
                pilot.cloudflare_query(next(iter(pilot.STATEMENTS)), 'offline', 'DO_NOT_LOG')
            self.assertEqual(post.call_count, 1)
        self.assertIn('D1_QUERY_START: schema', out.getvalue())
        self.assertIn('"rows_read": 1001', out.getvalue())
        self.assertNotIn('DO_NOT_LOG', out.getvalue())

    def test_main_stops_before_second_query_after_accounting_failure(self):
        with patch.dict('os.environ', {'CLOUDFLARE_ACCOUNT_ID': 'a' * 32, 'CLOUDFLARE_API_TOKEN': 'offline'}), patch.object(pilot, 'cloudflare_query', side_effect=RuntimeError('D1_ROW_READ_ACCOUNTING_UNKNOWN:schema')) as query:
            with self.assertRaisesRegex(RuntimeError, 'ACCOUNTING_UNKNOWN:schema'):
                pilot.main()
            self.assertEqual(query.call_count, 1)
        helper.Drive.assert_not_called()

    def test_main_passes_remaining_run_budget(self):
        with patch.dict('os.environ', {'CLOUDFLARE_ACCOUNT_ID': 'a' * 32, 'CLOUDFLARE_API_TOKEN': 'offline'}), patch.object(pilot, 'cloudflare_query', side_effect=[([{'sql': 'CREATE TABLE offline(id TEXT)'}], 600), RuntimeError('stop fixture')]) as query:
            with self.assertRaisesRegex(RuntimeError, 'stop fixture'):
                pilot.main()
            self.assertEqual(query.call_args.kwargs, {'remaining_budget': 400})
        helper.Drive.assert_not_called()

    def test_workflow_remains_paused(self):
        workflow = (ROOT / '.github/workflows/fbis-drive-archive-bounded-d1.yml').read_text()
        self.assertIn('D1_ARCHIVE_PAUSED_COST_GUARD', workflow)
        self.assertIn('exit 1', workflow)
        self.assertNotIn('python scripts/', workflow)
        self.assertNotIn('schedule:', workflow)

if __name__ == '__main__':
    unittest.main()
