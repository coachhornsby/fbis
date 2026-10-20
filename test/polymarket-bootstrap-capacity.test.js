import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrapWriteTarget} from '../functions/api/polymarket-bootstrap.js';

test('bootstrap observation writes prefer Q4 and never fall through to PRIMARY', () => {
  const history = { prepare() { return {}; } };
  const q4 = { prepare() { return {}; } };

  // Q4 unbound → fail closed (even with primary headroom or legacy history bound).
  assert.equal(bootstrapWriteTarget({ DB: {}, MARKET_HISTORY_DB: history }, 7_000_000_000).blocked, 'MARKET_HISTORY_2026Q4_UNBOUND_FAIL_CLOSED');
  assert.equal(bootstrapWriteTarget({ DB: {}, MARKET_HISTORY_DB: history }, 9_900_000_000).blocked, 'MARKET_HISTORY_2026Q4_UNBOUND_FAIL_CLOSED');
  assert.equal(bootstrapWriteTarget({ DB: {} }, 9_900_000_000).blocked, 'MARKET_HISTORY_2026Q4_UNBOUND_FAIL_CLOSED');

  // Legacy only with explicit escape hatch.
  assert.equal(
    bootstrapWriteTarget({
      DB: {},
      MARKET_HISTORY_DB: history,
      MARKET_HISTORY_ALLOW_LEGACY_WRITE: 'enabled',
    }, 9_900_000_000).store,
    'MARKET_HISTORY'
  );

  // Q4 always wins when bound.
  assert.equal(
    bootstrapWriteTarget({ DB: {}, MARKET_HISTORY_DB: history, MARKET_HISTORY_2026Q4_DB: q4 }, 7_000_000_000).store,
    'MARKET_HISTORY_2026Q4'
  );
  assert.equal(
    bootstrapWriteTarget({ DB: {}, MARKET_HISTORY_DB: history, MARKET_HISTORY_2026Q4_DB: q4 }, 9_900_000_000).store,
    'MARKET_HISTORY_2026Q4'
  );
});
