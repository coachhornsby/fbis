# FBIS: Cloudflare D1 ownership and college refresh contract
2026-10-17. Engineering release note; observed DB counts are point-in-time, not live counters.

## Physical storage roles

| D1 name | Pages binding | Permitted primary responsibility | Do not do |
| --- | --- | --- | --- |
| `fbis` | `DB` | Canonical sports identities, active snapshots, game projections, model/prediction/settlement provenance, shared CFBD/CBBD acquisition receipts and authoritative markets | Bulk archived Tier 3 CSV copies; unreviewed long-history migration |
| `fbis-operations-20261017` | `OPERATIONS_DB` | Operational job receipts, schedule diagnostics and eventual bounded health/attempt state | Canonical model or cross-database transaction authority; silently move shared quota receipts |
| `fbis-cfb-tier3-research` | `TIER3_DB` | Licensed, private, research-only CFBD Tier 3 weekly training rows and snapshot manifests | Direct public raw-data endpoint, production wagering authority |
| `fbis-market-history` | `MARKET_HISTORY_DB` | Shadow/history market observations and transfer evidence | Replace primary market/CLV/settlement reads without a qualified cutover |
| `fbis-cold-history-20261017` | **No Pages binding** | Retired historical market RESEARCH and historic CFB roster cohorts (protected archive) | Delete archived data or serve live public cards directly |
| `fbis-cfb-recovery-rehearsal-20261011` | **No Pages binding** | Verification and restoration exercises | Treat as primary live source |

Private R2 `ARCHIVE` stores immutable bulky inputs, source artifacts and restore packages. D1 is the indexed/transactional layer, not a substitute for R2 bulk storage. Each database has a separate size limit: the six are not pooled physical storage.

## Authorized storage recovery

Storage release `release-20261017-storage-a1` has independent receipt in [PR #1221](https://github.com/coachhornsby/fbis/pull/1221), `docs/storage-retire-apply-receipt-20261017.json`, including dry run and protected-cohort gates. Receipt measured primary from 10,007,482,368 down to **6,446,997,504 bytes**, retired 497,624 RESEARCH market observations and 430,971 CFB 2005–2025 roster observations. Preserved 2004, live CURRENT and return paths. The Cloudflare database-list endpoint may show stale size metadata; do not use its cached value to refute an exact verified write-probe and receipt, or to approve additional deletion.

During current read-only inspection:
- `TIER3_DB`: 59 Week 7 2026 training games; Week 5 and 6 are not proven imported there.
- `OPERATIONS_DB`: `operations_job_runs` and `operations_schema_migrations` exist, but `operations_job_runs` had zero rows.
- Primary `team_feature_snapshots`: CBB 2,554 rows, latest 2026-10-15; no CFB rows.
- `MARKET_HISTORY_DB`: 664,465 market observation rows at inspection.
- `COLD_HISTORY`: 430,971 CFB historical roster rows at inspection.

## College acquisition calendar

`/.github/workflows/college.yml` owns 07:30 **America/Chicago** (dual DST-safe cron offsets, exactly one active local invocation). `scripts/college-refresh-policy.mjs` decides jobs:
- CFB daily finalized-game research harvesting **August–January**, advanced/team intelligence **Monday only**, source releases permitting.
- CBB daily finalized-game research harvesting **November–April**, advanced/team intelligence **Monday only**, source releases permitting.
- Independent college-health runs daily, including offseason. Offseason archive/backfill remains explicitly operator-driven.
- Shared CFBD/CBBD receipt/quota policy still controls all network acquisition. A provider-confirmed exhaustion or CFBD 429 must stop both providers. Never infer a new subscription allowance from code settings alone.
- CBBD season key is the **ending year** (`2026–27` = `2027`); Torvik/KenPom adapters take **starting year** (`2026`), so callers translate once.
- Ratings and player/roster snapshots may update only when new evidence is published. Never interpret source retrieval time as verified underlying pregame cutoff.

## Release safety

No changes in this contract move primary quota receipts to operations D1, authorize automatic champion promotion, widen player-prop wagering authority, or relax feature PIT safety. New cross-DB workflows must use a durable event/outbox contract and reconciliation; Cloudflare D1 databases do not share an atomic transaction. During any blocked data/provider refresh, preserve prior verified snapshot values and label age/coverage truthfully.

CFB advanced/CORE/GraphQL integration (#1150, #1151, #1156, #1152) and CBB Tier 3 profile integration (#1149) require independent merge/rebase and production ingestion acceptance. Do not describe this scheduler as proof those integrations have merged.
