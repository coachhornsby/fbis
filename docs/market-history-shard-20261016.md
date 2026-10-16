# FBIS Market History D1 — Shadow Shard

## Current operating state (2026-10-16)

A dedicated Cloudflare D1 database `fbis-market-history` (UUID `c32ccf06-c896-4d24-bb89-3e87a7412899`) now exists independently from the primary `fbis` D1 (UUID `b50c724c-903b-4241-8ce1-48d931e7a44c`).

- Original 50-column `normalized_market_observations` schema and its ID and observation_key UNIQUE constraints are retained in the shard. Keep `can_qualify=0` and `can_authorize_wager=0` for observational source records.
- The new shard uses event/source indexes only and an additive `market_history_transfer_evidence` table recording original source row ID, provider payload digest, exact complete source row digest, and pilot-batch provenance.
- **Readback-verified pilot:** 30 immutable full rows: 10 Polymarket US, 10 Polymarket US WebSocket, 10 PinnOdds. All **50 columns** verified in both D1s, with no observed divergence or source record deletions.
- Independent R2 manifest, SHA-256 verified: `research/storage-recovery/2026-10-16/market-history-shard/pilot-66261188c7e99f6fb3171bdeab3bf6dbd11b35e347f2b2c264b80f1420c1ea3f.json`. It holds **row IDs and hashes**, not an extra public copy of price data.
- `wrangler.toml` binds `MARKET_HISTORY_DB` while retaining `DB`, `TIER3_DB`, and `ARCHIVE`.
- `GET /api/market-history-shard` is an **operator-only**, header-authenticated, strictly bounded reconciliation probe. The server checks every field (all 50) and original SHA-256 hash against primary D1. It does not return archived odds, payloads, source secrets, or give qualification authority. A missing binding or mismatched source fails closed with 503. Production release checks confirm anonymous 403 and private 200.
- **No cutover**: live market writers, game-card endpoints, Polymarket WS collector, PinnOdds collector, market-grade/CLV/settlement and prospective wager decisions continue to use the original primary D1. No production row deletion, source R2 delete, model routing change, or archive-based qualification occurred.

## Why new writer cutover is still blocked

`marketObservationLedger.persistNormalizedMarketBatch(db)` is used by multiple collecting systems. `latestVenueOffers(db)`, `/api/market-observations` and `polymarket-ws-capture` still query primary `normalized_market_observations`. `normalized_market_decision_links` has a database-local foreign key to observation IDs, so a partial move must preserve atomic visibility and decision evidence. Although decision-links and grade tables were empty in the reviewed primary D1 snapshot, that is not a permanent assumption.

**Gates before changing live write ownership or deleting primary records:**
1. Mirror new observations to the separate DB after canonical primary writes using exact persisted source row IDs and original full-row hashes; keep authoritative source in primary during shadow period and publish missed/lag counts.
2. Verify continuous delivery with backpressure/retry, deduplication across primary/shard, provider source clocks, and deterministic link/grade identity; do not silently skip rows.
3. Build exact live read routing with fallback and contract tests for each consumer, including Polymarket, PinnOdds, tennis, soccer, CLV, closing line and grading. No unsupported cross-D1 SQL JOINs.
4. Backfill cohort-by-cohort with complete row/column SHA-256 parity and immutable R2 manifests. Retain critical decision-linked and prospective evidence until the complete recovery path is independently rehearsed.
5. Rehearse rollback and independent restore of the target historical cohort and verify D1 `file_size` decreases after bounded retirement. Merely adding a second DB does not free bytes from the primary.
6. Confirm actual Cloudflare D1/R2 charges and request volume for the user's approximately $10/month preference before scaling.

## Operations

The schema source is `sql/shards/market-history-v1.sql`; it is intentionally **not** in the primary database migration list. Never apply it using `wrangler d1 migrations apply fbis`. It targets only `fbis-market-history`.

A new shard-binding configuration or independent pilot recovery must not be confused with approval to migrate canonical source or change betting strategy/price authority.

## Opt-in WebSocket-only live shadow replication

`functions/lib/marketHistoryWsShadow.js` implements a source-preserving, **explicit-off-by-default** post-commit mirror. The only activation switch is the Pages plain-text environment variable `MARKET_HISTORY_SHADOW_WS=enabled`; any other value prevents all shadow reads and writes.

Once separately enabled:
- Only accepted `Polymarket US WebSocket` normalized observation IDs may be mirrored; maximum **16 IDs** per invocation, exact format `nmo_` + 28 lowercase hex chars.
- The primary `env.DB` insert completes **before** a mirror request is attempted. Source rows are read from actual stored canonical D1 values and copied across all 50 columns without regenerating hashes, IDs, provider timestamps or odds.
- After each shard insert, reread the entire target row and compare SHA-256 of all 50 fields. Record exact original primary rowid and source raw/full digests in `market_history_transfer_evidence`. Existing evidence with conflicting hashes causes a hard error.
- Mirroring failures are reported as `shardShadow.state=FAIL_CLOSED` without rolling back or misreporting a successful **primary** market capture. Operators must address lag before any read or write cutover.
- No cross-D1 JOIN or FK migration; `normalized_market_decision_links`, CLV and economic grading stay authoritative on primary D1.
- Tests cover disabled-by-default behavior, parity, idempotence, malformed IDs, missing binding, tampering, and wager-authority rejection.

**Operational status:** Do not enable the switch until the shadow copy is validated against actual WebSocket production capture records under a bounded session. This code alone never routes the live system away from primary D1, cannot shrink the primary database, and does not satisfy all historical cohort recovery requirements.
