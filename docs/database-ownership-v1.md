# FBIS database ownership contract v1

**Status:** Production governance  
**Purpose:** Keep primary D1 under sustainable headroom by assigning explicit ownership and refusing new high-volume growth on the wrong database.

## Databases

| Binding / name | UUID | Owns | Must not own |
|---|---|---|---|
| `DB` / `fbis` (primary) | `b50c724c-903b-4241-8ce1-48d931e7a44c` | Live cards, current market quotes used for qualification, model inputs, settlement/CLV/decision links, canonical identities, published projections | Unbounded historical market ticks, raw historic roster dumps, ops telemetry growth, cold archives |
| `OPERATIONS_DB` / `fbis-operations-20261017` | `2371df3a-17bf-44d6-abf0-d275cf2f331e` | Ops control plane, capacity measurements, retention gates, pipeline validation receipts, query-performance findings, job/run telemetry preferred for new writes | Betting qualification authority, live market source-of-truth, cold historical source copies |
| `MARKET_HISTORY_DB` / `fbis-market-history` | `c32ccf06-c896-4d24-bb89-3e87a7412899` | Shadow/recovery copies of normalized market observations, transfer evidence | Decision links, CLV, settlement, live card reads (until consumer cutover is separately approved) |
| `COLD_HISTORY_DB` / `fbis-cold-history-20261017` | `6fad1baf-126f-4ab8-9b80-a7d71637d6d4` | Verified offline copies of frozen historical cohorts after R2 + independent restore parity; qualified RESEARCH reads when `COLD_MARKET_ARCHIVE_READS=enabled` | Live CURRENT quote authority, qualification writes, ops telemetry |

`TIER3_DB` remains licensed CFB research isolation and is outside this four-way ownership split.

## Write routing rules

1. **New operational rows** (ops health, run manifests, watchdog metrics, invariant checks, capacity alerts, retention gate records, pipeline validation runs, performance audit findings) write to `OPERATIONS_DB` when bound. Primary is fallback only when the operations binding is absent.
2. **New high-volume market history** that is not required for live qualification belongs on `MARKET_HISTORY_DB` (shadow/recovery) or cold history after verified archive — not primary.
3. **Primary** remains authoritative for live product facts until a reviewed cutover says otherwise.
4. **No automatic DELETE** from primary. Retention release requires a verified recovery copy (R2 readback + independent restore parity) and an explicit new release manifest with `retentionReleaseAuthorized: true`.
5. **Polymarket US WebSocket CURRENT ticks** write to primary when healthy. When primary `size_after` is known and ≥ 9.5 GB soft limit, the stream Worker prefers `MARKET_HISTORY_DB` (+ R2 spill) so FREEZE / continuous-learning retain headroom. Excess CURRENT WS ticks older than the live keep window may be retired only under an authorized capacity-relief package (see `docs/storage-current-ws-capacity-relief-authorized-20261018.json`).

## Capacity safeguards

Per-database hard cap: **10,000,000,000 bytes**.

Alert thresholds (all owned databases):

| Utilization | Level | Operator action |
|---:|---|---|
| ≥ 80% | `WATCH` | Archive review; stop new primary-bound high-volume writers |
| ≥ 85% | `HIGH` | Retention preparation; prefer OPERATIONS_DB / history shard |
| ≥ 90% | `CRITICAL` | Incident; daily monitor exits nonzero after durable evidence |

## Pipeline validation

Scheduled collection, projections, odds, model updates, and player props are validated across supported board sports. Results persist on `OPERATIONS_DB`.

## Performance

Expensive query and redundant-write findings are recorded on `OPERATIONS_DB`. Index retirement and write reduction follow existing reversible migration patterns — never unqualified drops of unique/PIT evidence indexes.
