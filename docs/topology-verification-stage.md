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

Pages **production** D1 bindings were missing CORE / sport / Q4 history DBs (preview already had them). Production was patched to match:

- All sport D1 bindings bound
- `MARKET_HISTORY_2026Q4_DB` bound
- All `SPORT_DB_MODE_*=shadow` and `NHL_SPORT_DB_MODE=shadow`

Operator check: `POST /api/database-topology` `{ "operation": "verify-bindings" }`.

## 3. Shadow-mode hard guarantee

Product code must use `productSportDbHandle()` / `isSportDbAuthoritative()`.

- Shadow / primary → always PRIMARY `DB`
- `resolveSportDb().sportDb` is telemetry/copy only
- Tests in `test/sport-db-shadow-routing.test.js` prove shadow cannot accidentally route product IO

## 4. NHL shadow validation

- Count parity: `nhl-parity`
- Record-level sample (ids, starts, frozen_at, projection fields): `nhl-record-parity`

## 5. NFL / CFB next (shadow only)

- `sport-copy` / `sport-parity` limited to `nfl` and `cfb`
- Copy refuses to run if sport mode is already active

## 6. Market history protection

- Q4 write preference via `resolveMarketHistoryWriteDb`
- Archive scan never deletes (`market-history-archive-scan`)
- Retention gate blocks delete without verified R2 (`retention-gate-evaluate`)

## 7. Cross-sport board / CORE

- `core-board-summary-publish` / `core-board-summary-read`
- Summaries are written to CORE (fallback primary); boards must not fan-out to sport D1s
