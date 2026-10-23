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
    }, 9_900_000_000, 1_000_000_000).store,
    'MARKET_HISTORY'
  );

  // Q4 always wins when bound.
  assert.equal(
    bootstrapWriteTarget({ DB: {}, MARKET_HISTORY_DB: history, MARKET_HISTORY_2026Q4_DB: q4 }, 7_000_000_000, 1_000_000_000).store,
    'MARKET_HISTORY_2026Q4'
  );
  assert.equal(
    bootstrapWriteTarget({ DB: {}, MARKET_HISTORY_DB: history, MARKET_HISTORY_2026Q4_DB: q4 }, 9_900_000_000, 1_000_000_000).store,
    'MARKET_HISTORY_2026Q4'
  );
});

test('bootstrap Q4/legacy capacity is measured independently and never spills into primary',()=>{
 const q4={prepare(){return {}}},legacy={prepare(){return {}}};
 const env={DB:{},MARKET_HISTORY_2026Q4_DB:q4,MARKET_HISTORY_DB:legacy,MARKET_HISTORY_ALLOW_LEGACY_WRITE:'enabled'};
 assert.equal(bootstrapWriteTarget(env,7_000_000_000,null).blocked,'MARKET_HISTORY_SIZE_UNVERIFIED_FAIL_CLOSED');
 assert.equal(bootstrapWriteTarget(env,7_000_000_000,0).blocked,'MARKET_HISTORY_SIZE_UNVERIFIED_FAIL_CLOSED');
 assert.equal(bootstrapWriteTarget(env,7_000_000_000,8_499_999_999).db,q4);
 assert.equal(bootstrapWriteTarget(env,7_000_000_000,8_500_000_000).blocked,'MARKET_HISTORY_CAPACITY_HIGH_FAIL_CLOSED');
 assert.equal(bootstrapWriteTarget(env,7_000_000_000,9_109_180_416).blocked,'MARKET_HISTORY_CAPACITY_CRITICAL_FAIL_CLOSED');
 assert.equal(bootstrapWriteTarget(env,7_000_000_000,9_999_998_976).db,null);
 // Even when Q4 is missing, explicit legacy permission cannot bypass capacity.
 const fallback={...env,MARKET_HISTORY_2026Q4_DB:null};
 assert.equal(bootstrapWriteTarget(fallback,7_000_000_000,9_999_998_976).db,null);
 assert.equal(bootstrapWriteTarget(fallback,7_000_000_000,1_000_000_000).db,legacy);
});
