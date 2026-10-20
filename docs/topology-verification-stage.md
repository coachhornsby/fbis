# Topology verification stage (PR #1296)

**Do not set any `SPORT_DB_MODE_*=sport` yet.** Primary remains authoritative for all product reads/writes.

## 1. Worker Builds triage (resolved)

| Worker | Cause | Action |
|---|---|---|
| `fbis-market-probe-20261007` | Obsolete archival probe; Workers Builds ran `npm run build` + bare `wrangler deploy` against Pages `wrangler.toml` → "Missing entry-point" | **Deleted** Workers Builds config. Probe remains archived; no auto-deploy. |
| `fbis-orchestrator` | Same misconfigured Workers Builds (`npx wrangler deploy` without `--config wrangler.orchestrator.toml`) | **Deleted** Workers Builds config. Real deploys stay on GitHub Actions `deploy-fbis-workers.yml` / `deploy-cloudflare-orchestrator.yml`. |
| `fbis-soccer-pitchapi-backfill` | Same misconfigured Workers Builds | **Deleted** Workers Builds config. Real deploys stay on GitHub Actions soccer-backfill job. |

Confirmed failure log: Vite build succeeds, then `wrangler deploy` warns it is a Pages project and fails with missing Worker entry-point.

## 2. Production binding + canonical-data integrity gate

**Do not create additional databases. Do not activate sport authority.**

### Binding wipe root cause

`origin/main` `wrangler.toml` still lists only the legacy five Pages D1 bindings
(`DB`, `TIER3_DB`, `MARKET_HISTORY_DB`, `OPERATIONS_DB`, `COLD_HISTORY_DB`).
Every main Pages deploy (`wrangler pages deploy`) overwrites project
`deployment_configs` from that file and drops `CORE_DB` / sport D1s / Q4 /
shadow modes from the live Functions surface.

**Durable fix:** merge this branch’s full `wrangler.toml` + stream Q4 binding
to main. Dashboard/API restores alone are temporary until main carries the
bindings.

### Gate surfaces

- `functions/lib/topologyBindingGate.js` — required Pages + stream D1s + shadow modes
- Ops: `topology-binding-gate`, `verify-bindings`, restore plan in response
- Pages project configs restored with CORE + all sport D1s + Q4 + `SPORT_DB_MODE_*=shadow`
- Stream Worker bound to `MARKET_HISTORY_2026Q4_DB` (fail-closed WS/bootstrap writers)

### Canonical evidence

- Contract: `functions/lib/canonicalEvidenceContract.js` (`fbis-canonical-evidence-v1`)
- Envelope stores the **complete PRIMARY source row** (`SELECT *`) plus an explicit
  `ownership` block: `materializedOnSport` vs `remainPrimaryCanonical`
- PRIMARY remains canonical for `remainPrimaryCanonical` fields until an **approved**
  cutover receipt row exists in CORE (`fbis_sport_cutover_approvals`)
- A non-empty `SPORT_CUTOVER_RECEIPT_*` env var alone never authorizes sport IO
- SQL: `sql/shards/sport-working-v1-evidence.sql`, `sql/shards/core-v1-cutover-approvals.sql`
- Backfill: `sport-evidence-backfill` op or `node scripts/backfill-sport-evidence.mjs --sport nfl`

Operator check: `POST /api/database-topology` `{ "operation": "verify-bindings" }`
and `{ "operation": "canonical-evidence-contract" }`.

### Market-history writers

- Bootstrap + WS observation writes prefer Q4 only; no PRIMARY observation fallback
- Legacy history requires `MARKET_HISTORY_ALLOW_LEGACY_WRITE=enabled`
- Stream deploy health requires `wsPersistTarget.reason == "WS_Q4_DEFAULT"`

## 3. Shadow-mode hard guarantee

Product code must use `productSportDbHandle()` / `isSportDbAuthoritative()`.

- Shadow / primary → always PRIMARY `DB`
- `resolveSportDb().sportDb` is telemetry/copy only
- **Caller `{mode:'sport'}` cannot bypass deployed env shadow** — production mode comes only from `SPORT_DB_MODE_*` / `NHL_SPORT_DB_MODE`
- Tests in `test/sport-db-shadow-routing.test.js` prove shadow cannot accidentally route product IO

## 4. NHL shadow validation

- Count parity: `nhl-parity`
- Record-level sample (ids, starts, frozen_at, projection fields): `nhl-record-parity`

## 5. NFL / CFB next (shadow only)

- `sport-copy` / `sport-parity` / `sport-projection-reconcile` limited to `nfl` and `cfb` (reconcile also allows nhl)
- Copy uses deterministic keyset pagination + checkpoints; refuses to run if sport mode is already active
- `sport-cutover-rehearsal` proves rollback in-process — **never** sets live `SPORT_DB_MODE_*=sport`

## 6. Market history protection

- Q4 write preference via `resolveMarketHistoryWriteDb`
- **Fail-closed** when active partition is full/unready/out-of-window (no silent legacy fallback)
- Archive scan never deletes (`market-history-archive-scan`)
- Retention gate blocks delete without verified R2 (`retention-gate-evaluate`)

## 7. Cross-sport board / CORE

- Freshness SLA: 15 minutes (`CORE_BOARD_SUMMARY_MAX_AGE_MS`)
- `core-board-summary-publish` / `core-board-summary-read` / `core-board-summary-require-fresh`
- Board consumer: `loadCoreBoardOverview` / op `core-board-overview` — CORE only, fail-closed
- Missing or stale sport entries → unusable; boards must not fan-out to sport D1s

## 8. Cutover status

**Production sport-database cutover remains blocked.** Primary D1 stays authoritative while PR #1296 continues verification.
