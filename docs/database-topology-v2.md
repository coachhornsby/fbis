# FBIS database topology v2

**Status:** Approved architecture direction — implementation in progress  
**Contract:** `fbis-database-topology-v2` (`functions/lib/databaseTopology.js`)

Cloudflare D1 has a **hard 10 GB ceiling per database**. FBIS therefore scales across smaller databases while keeping one application surface.

## Target layout

| Storage | Binding | Owns |
|---|---|---|
| **CORE_DB** | `CORE_DB` / `fbis-core` | Shared settings, model registry, executed-bet index, dashboard summaries |
| **OPERATIONS_DB** | `OPERATIONS_DB` | Job status, errors, capacity, alerts, collection receipts (existing) |
| **PRIMARY** | `DB` / `fbis` | Temporary authority during migration; shared identities until CORE cutover |
| **NHL_DB** (pilot) | `NHL_DB` / `fbis-nhl` | NHL schedules, projections, research, settlements, calibration/CLV |
| **Other sport DBs** | `NFL_DB`, `CFB_DB`, … | Planned — same contract as NHL once provisioned |
| **Market history partitions** | `MARKET_HISTORY_DB`, `MARKET_HISTORY_2026Q4_DB` | Searchable odds in bounded windows |
| **COLD_HISTORY_DB** | `COLD_HISTORY_DB` | Verified offline historical copies |
| **R2 `ARCHIVE`** | `ARCHIVE` | Raw provider responses, archives, model artifacts, recovery copies |

## Critical catch

**Splitting by sport alone does not stop market-history growth.** An NHL database can still fill if every WebSocket tick is retained indefinitely.

Policy:

1. Hot window in D1: **7 days** of searchable market observations (`MARKET_HISTORY_HOT_WINDOW_MS`).
2. Older observations: archive to R2, then retention-gate delete only with verified recovery.
3. New recovery/WS writes prefer `MARKET_HISTORY_2026Q4_DB` when bound (legacy history is near capacity).

## Migration phases

1. Inventory table sizes, readers, writers (`scripts/d1-topology-inventory.mjs`).
2. Reuse existing `OPERATIONS_DB` (already live).
3. **Pilot NHL:** schema ready, copy + read parity (`POST /api/database-topology` ops `nhl-copy` / `nhl-parity`). Keep `NHL_SPORT_DB_MODE=shadow` until parity passes.
4. Move highest-growth sports next (soccer / tennis / NFL as measured).
5. Retire old primary copies only after recovery and consistency checks pass.

## Routing

- `resolveCoreDb(env)` — CORE with primary fallback
- `resolveSportDb(env, sport)` — sport DB when bound; otherwise primary
- `resolveMarketHistoryWriteDb(env)` — newest under-capacity partition
- `listMarketHistoryReadDbs(env)` — merged history reads
- `marketHistoryRetentionDecision({ collectedAt })` — hot-window policy (no auto-delete)

Cross-sport dashboards must read **prepared summaries on CORE_DB**, not fan-out query every sport DB on page load.

## Operator API

`GET /api/database-topology` (harvest secret) — live capacity + routing snapshot.  
`POST /api/database-topology` — `nhl-copy`, `nhl-parity`, `market-history-write-target`.

## Provisioned in this release

| Database | UUID |
|---|---|
| `fbis-core` | `a5b438fa-eb16-4f03-95d7-1fc58ac72f04` |
| `fbis-nhl` | `a0aa010c-40d3-4d2f-8109-eca4e74e2a73` |
| `fbis-market-history-2026q4` | `e8b0b65d-90a6-4842-8ee7-0f85d75afb4c` |
