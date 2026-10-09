# INC-20261008-001 — draft repair, no release authorization

Baseline main/Pages: `16afa6478e8f59deaf3c003d3a32a07c492aaff0`, verified October 8 at 22:42 UTC. Independent review and operator approval required before merge. No deployment, live settlement, D1/R2 mutations, executed-bet changes or paid acquisition performed.

## Production evidence (read-only)

Queries against D1 `b50c724c-903b-4241-8ce1-48d931e7a44c`:

```sql
SELECT event_id,COUNT(*) n,SUM(length(market_json)) market_bytes,
 SUM(length(projection_json)) projection_bytes
FROM mlb_prop_prospective_evidence
WHERE event_date='2026-10-07' AND temporal_integrity=1 AND settled_at IS NULL
GROUP BY event_id;
SELECT operation,event_date,shard,shards,status,started_at,details_json
FROM mlb_prop_evidence_runs
WHERE operation='settle' AND event_date='2026-10-07'
ORDER BY started_at DESC LIMIT 12;
SELECT COUNT(*) n,SUM(length(state_snapshot_json)) state_bytes,
 MAX(length(state_snapshot_json)) max_state_bytes
FROM mlb_prop_prospective_evidence
WHERE event_id='849838' AND settled_at IS NULL AND temporal_integrity=1;
EXPLAIN QUERY PLAN SELECT * FROM mlb_prop_prospective_evidence
WHERE event_id='849838' AND settled_at IS NULL AND temporal_integrity=1;
```

| Event | Pending eligible observations |
|---|---:|
| 849822 | 769 |
| 849827 | 502 |
| 849833 | 207 |
| 849838 | 2,317 |
| Total | 3,795 |

Persisted FAILED settlement at `2026-10-08T21:16:56.829Z`, shard 0/12, records `D1_ERROR: Memory limit exceeded before EOF.` Earlier `2026-10-08T05:56:27.023Z` remains RUNNING. No stack trace identifies the precise statement. Game 849838 has 215,223,581 state-snapshot characters (max 96,240 per row), 3,343,067 projection characters and 1,117,008 market characters. SQLite length measures characters, not UTF-8 byte size; the state sum alone is a lower bound of that many UTF-8 bytes. All October 7 pending IDs checked are 64-character lowercase hex. Query plan is a full table scan.

Confirmed wasteful result materialization: `settle` loaded every game row, including unused frozen snapshots, before `.filter(evidenceShardAccept)`. Every shard repeats the full payload unless prior shards have already settled some rows. Persisted memory error plus a >215 MB unused result component strongly supports this as the incident cause; precise Worker versus D1 serialization allocation is unproven. No live reproduction of the oversized SELECT was attempted. Cloudflare documents memory-bounded D1 serialization: https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/workers/platform/limits/ .

## Contract and patch

`functions/api/mlb-prop-evidence.js::settle`: replace only its row-loading expression. New `functions/lib/mlbSettlementQuery.js` provides parameterized SQL with original `event_id`, `settled_at IS NULL`, `temporal_integrity=1` predicates. Do not add an event-date predicate: the original inner query covers eligible rows for the selected game across dates. Original sorted event selection/limitGames and fetch/final-state behavior remain unchanged.

Shard ownership remains `parseInt(String(id || '0').slice(0,8),16) % shards === shard`, with shards <=1 admitting all. Canonical hex prefixes use eight exact integer nibble terms, safely below Number's exact integer bound. Irregular IDs retain bounded eight-character parsing, JavaScript leading whitespace, optional sign/0x, partial parse and missing-digit rejection. SQL `mod`, verified available in production D1, preserves fractional-divisor and negative-remainder behavior unlike SQLite `%` integer coercion. Tests compare against the original algorithm for 1/2/12/32 and fractional divisors. No alternate hash or ownership policy.

Select only the 12 fields read downstream: id, event_id, player_id, player_name, market, candidate_side, market_line, market_json, market_source, sportsbook, duplicate_key, market_observed_at. Stored snapshots and provenance are not deleted or rewritten. No explicit ordering/cursor existed in the inner query; no new ordering/cursor/limit is introduced. Same one evidence SELECT per final game; no N+1 reads. Grading, canonical/economic writes, eligibility, audit failures, fetch retries, per-row `WHERE id=? AND settled_at IS NULL` idempotence and executed-bet accounting remain unchanged.

## Measurements and limits

Read-only D1 aggregate wrappers around the actual final query, game 849838:
shard counts `[196,180,199,223,211,213,197,197,218,178,206,99]`, total 2,317. Each query reports 5,111 rows read (61,332 across twelve) and zero writes; approximately 20–35 ms SQL duration. These are COUNT validations, not full handler runs or peak-memory measurements. Existing game-only predicate still scans the table; no index/schema change in this patch. First recursive-only prototype read 49,134 per shard and was rejected; final canonical fast path removes that amplification.

Deterministic local 2,317-row fixture includes 96,240-character unused snapshots per row. Across twelve queries exactly 2,317 rows return; serialized selected payload totals 912,910 bytes, versus 222,988,080 unused state bytes per original full-game query. Synthetic shard counts differ from production because IDs differ. Local duration varies; test logs contain the actual measurement. Peak application memory was not measured; no production memory-recovery claim.

No absolute per-shard row/byte cap is added. Hash skew, oversized needed market_json or future growth can still require a separately reviewed cursor design. Query materialization is proportional to the requested shard's needed fields, not all game snapshots. The existing canonical/economic write chain is not atomic across every step; failure after an observation write but before downstream lineage writes can require reconciliation. This is an existing independent retry risk, not repaired here. Do not change accounting to hide it.

Two legacy executed bets, current open-card inventory and their resolution were investigation inputs, not reverified in this narrowly scoped read-only query investigation. No ledger records touched.

## Regression and review gates

Real SQLite executes the exact query. Fixtures cover parser parity, 12-shard full coverage and unique ownership, 2,317-row payload bounds, mixed games, settled/ineligible rows, empty results, duplicate primary-key behavior and identical-player/market distinct IDs. Actual exported handler executes against a local SQLite adapter with mocked final MLB feed; verify result, actual, source, canonical lineage, repeated settlement, FAILED audit on read failure and retry after partial completion. Existing economic grading/authority tests remain in standard suite. The new suite runs in `npm test`.

Reviewer: inspect all 12 consumed columns against every downstream access; verify parser equivalence and mod availability; review unchanged game eligibility/order; inspect idempotent and lineage guards; confirm no migration/workflow/authority changes; require exact-head hosted CI. Operator must separately authorize merge/deployment and prospective natural settlement acceptance. Do not replay old jobs or close the incident from local fixtures alone.
