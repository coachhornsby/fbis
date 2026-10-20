# Topology verification stage (PR #1296)

**Do not set any `SPORT_DB_MODE_*=sport` yet.** Primary remains authoritative for all product reads/writes.

## 1. Worker Builds triage (resolved)

| Worker | Cause | Action |
|---|---|---|
| `fbis-market-probe-20261007` | Obsolete archival probe; Workers Builds ran `npm run build` + bare `wrangler deploy` against Pages `wrangler.toml` → "Missing entry-point" | **Deleted** Workers Builds config. Probe remains archived; no auto-deploy. |
| `fbis-orchestrator` | Same misconfigured Workers Builds (`npx wrangler deploy` without `--config wrangler.orchestrator.toml`) | **Deleted** Workers Builds config. Real deploys stay on GitHub Actions `deploy-fbis-workers.yml` / `deploy-cloudflare-orchestrator.yml`. |
| `fbis-soccer-pitchapi-backfill` | Same misconfigured Workers Builds | **Deleted** Workers Builds config. Real deploys stay on GitHub Actions soccer-backfill job. |

Confirmed failure log: Vite build succeeds, then `wrangler deploy` warns it is a Pages project and fails with missing Worker entry-point.

## 2. Deployment bindings

Pages **production and preview** project configs are patched to include:

- All sport D1 bindings + `CORE_DB` + `MARKET_HISTORY_2026Q4_DB`
- All `SPORT_DB_MODE_*=shadow` and `NHL_SPORT_DB_MODE=shadow`

A main deploy that only carried the legacy five D1 bindings can drop sport/CORE/Q4 from the live deployment until the next Pages deploy picks up the restored project config. Re-check after every production deploy.

`fbis-polymarket-us-stream` is bound to `MARKET_HISTORY_2026Q4_DB` in addition to legacy `MARKET_HISTORY_DB`.

Operator check: `POST /api/database-topology` `{ "operation": "verify-bindings" }`.

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

- `core-board-summary-publish` / `core-board-summary-read`
- Missing sport entries fail closed (`complete:false`); boards must not fan-out to sport D1s

## 8. Cutover status

**Production sport-database cutover remains blocked.** Primary D1 stays authoritative while PR #1296 continues verification.
