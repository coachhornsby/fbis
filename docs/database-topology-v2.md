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
| **Sport working DBs** | `NHL_DB`, `NFL_DB`, `CFB_DB`, `CBB_DB`, `NBA_DB`, `WNBA_DB`, `MLB_DB`, `SOCCER_DB`, `TENNIS_DB`, `NPB_DB`, `KBO_DB` | Per-sport schedules, projections, research, settlements (primary authority until parity cutover) |
| **Market history partitions** | `MARKET_HISTORY_DB`, `MARKET_HISTORY_2026Q4_DB` | Searchable odds in bounded windows |
| **COLD_HISTORY_DB** | `COLD_HISTORY_DB` | Verified offline historical copies |
| **R2 `ARCHIVE`** | `ARCHIVE` | Raw provider responses, archives, model artifacts, recovery copies |

## Critical catch

**Splitting by sport alone does not stop market-history growth.** A sport database can still fill if every WebSocket tick is retained indefinitely.

Policy:

1. Hot window in D1: **7 days** of searchable market observations (`MARKET_HISTORY_HOT_WINDOW_MS`).
2. Older observations: archive to R2, then retention-gate delete only with verified recovery.
3. New recovery/WS writes prefer `MARKET_HISTORY_2026Q4_DB` when bound (legacy history is near capacity).

## Migration phases

1. Inventory table sizes, readers, writers (`scripts/d1-topology-inventory.mjs`).
2. Reuse existing `OPERATIONS_DB` (already live).
3. **Pilot NHL (shadow):** count + record-level parity OK. Keep `NHL_SPORT_DB_MODE=shadow` — **no product cutover**.
4. **All sport D1s** provisioned + schema; shadow only. Next controlled copies: **NFL then CFB**.
5. **Market-history protection:** Q4 write routing + R2 archive scan + retention gate before any legacy delete.
6. **CORE board summaries** must stay complete before any sport becomes authoritative.
7. Retire old primary copies only after recovery and consistency checks pass.

See `docs/topology-verification-stage.md` for Worker Builds triage, binding verification, and shadow-routing guarantees.

## Routing

- `resolveCoreDb(env)` — CORE with primary fallback
- `resolveSportDb(env, sport)` — sport DB when bound; otherwise primary
- `resolveMarketHistoryWriteDb(env)` — newest under-capacity partition
- `listMarketHistoryReadDbs(env)` — merged history reads
- `marketHistoryRetentionDecision({ collectedAt })` — hot-window policy (no auto-delete)

Cross-sport dashboards must read **prepared summaries on CORE_DB**, not fan-out query every sport DB on page load.

## Operator API

`GET /api/database-topology` (harvest secret) — live capacity + routing snapshot.  
`POST /api/database-topology` — `verify-bindings`, `nhl-copy`, `nhl-parity`, `nhl-record-parity`, `nhl-shadow-compare`, `sport-copy` / `sport-parity` / `sport-projection-reconcile` (nfl|cfb), `sport-cutover-rehearsal`, `core-board-summary-publish` / `core-board-summary-read`, `market-history-write-target`, `market-history-archive-scan`, `retention-gate-evaluate`.

Product IO must use `productSportDbHandle()` — shadow mode never returns a sport D1 for reads/writes. Caller `{mode:'sport'}` cannot bypass deployed env shadow. **Production sport cutover remains blocked; primary stays authoritative.**

## Provisioned sport D1s

| Database | Binding | UUID | Status |
|---|---|---|---|
| `fbis-core` | `CORE_DB` | `a5b438fa-eb16-4f03-95d7-1fc58ac72f04` | ready |
| `fbis-nhl` | `NHL_DB` | `a0aa010c-40d3-4d2f-8109-eca4e74e2a73` | `PARITY_OK` (shadow) |
| `fbis-nfl` | `NFL_DB` | `0a49cad0-4bf9-4e01-88ce-be54123f712d` | `SCHEMA_READY` |
| `fbis-cfb` | `CFB_DB` | `b589c91c-c53d-4f4a-9d32-99c4468e3033` | `SCHEMA_READY` |
| `fbis-cbb` | `CBB_DB` | `f00af21e-72b5-4e7c-bb10-b08f2c59dace` | `SCHEMA_READY` |
| `fbis-nba` | `NBA_DB` | `ed992525-d2ed-4b1d-8a12-feeb2efa152c` | `SCHEMA_READY` |
| `fbis-wnba` | `WNBA_DB` | `94e40293-d433-493e-af9e-0564ea1b6fcb` | `SCHEMA_READY` |
| `fbis-mlb` | `MLB_DB` | `b188629e-cdf7-49e6-b693-dead80777377` | `SCHEMA_READY` |
| `fbis-soccer` | `SOCCER_DB` | `c275978c-fce9-49c9-a1ce-4e2fcbea6d23` | `SCHEMA_READY` |
| `fbis-tennis` | `TENNIS_DB` | `c491e479-f9f6-49a9-ace9-962aef68cc64` | `SCHEMA_READY` |
| `fbis-npb` | `NPB_DB` | `010ef83f-a472-4ab2-b9af-589541895e8e` | `SCHEMA_READY` |
| `fbis-kbo` | `KBO_DB` | `77a8e7bc-c022-490f-98df-3adb479d1e52` | `SCHEMA_READY` |
| `fbis-market-history-2026q4` | `MARKET_HISTORY_2026Q4_DB` | `e8b0b65d-90a6-4842-8ee7-0f85d75afb4c` | active partition |
