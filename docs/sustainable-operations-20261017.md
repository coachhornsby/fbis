# FBIS sustainable operations shift — 2026-10-17

Emergency recovery preserved product data at the primary D1 ceiling. With capacity restored enough to operate, this contract moves FBIS to durable multi-database ownership so primary does not grow back toward 10 GB.

## Delivered

1. **Database ownership** (`docs/database-ownership-v1.md`, `functions/lib/databaseOwnership.js`)
   - Primary: live product authority
   - `OPERATIONS_DB`: preferred ops / capacity / retention / validation / performance findings
   - `MARKET_HISTORY_DB`: market observation shadow/recovery
   - Cold history `fbis-cold-history-20261017`: verified offline copies only
   - Guards block new RESEARCH market volume and historic raw CFB roster re-ingest on primary

2. **Capacity safeguards**
   - Explicit alerts at **80% / 85% / 90%** on every owned database
   - Daily monitor measures primary, market-history, operations, and cold-history
   - Operator `/api/storage-capacity` includes operations binding when present
   - Retention still requires verified R2 readback + independent restore + explicit authorization (`functions/lib/retentionGate.js`)

3. **Pipeline validation**
   - Collection, projections, odds, model updates, and player props across board sports
   - Operator `GET /api/pipeline-validation` (harvest secret); receipts prefer `OPERATIONS_DB`

4. **Performance audit**
   - Static findings for expensive query shapes, retired indexes, dual writes, and ops-on-primary growth
   - `scripts/d1-performance-audit.mjs` + `functions/lib/d1PerformanceAudit.js`

5. **OPERATIONS_DB routing**
   - Ops control plane writers (`opsHealthLedger`, job telemetry sync) prefer `OPERATIONS_DB` when bound
   - Schema bootstrap: `sql/shards/operations-v1.sql`
   - Product tables and qualification authority remain on primary
   - New RESEARCH market writes prefer `MARKET_HISTORY_DB`; pre-cutoff RESEARCH continues through the existing cold-history gate when enabled

## Operator follow-up

Apply `sql/shards/operations-v1.sql` to remote `fbis-operations-20261017` so ops writes leave primary:

```bash
npx wrangler d1 execute OPERATIONS_DB --remote --file=sql/shards/operations-v1.sql
```

Until that schema is present, `withOperationsWrite()` / `resolveReadyOperationsDb()` keep control-plane writers on primary (`OPERATIONS_SCHEMA_UNAVAILABLE`), and retry primary if an ops write still hits `no such table`.

**2026-10-17:** `sql/shards/operations-v1.sql` was applied to remote `fbis-operations-20261017` (9 control-plane tables + 9 seeded components). Verify after deploy with operator `GET /api/operations-routing?probeWrite=1` (harvest secret).

## Explicit non-goals

- No unqualified primary DELETE / VACUUM
- No reinterpretation of manifests with `retentionReleaseAuthorized: false`
- No live card / settlement / CLV cutover onto market-history or cold history
- `job_runs` / `api_usage` remain on primary until dual-read readiness (documented as candidates)
