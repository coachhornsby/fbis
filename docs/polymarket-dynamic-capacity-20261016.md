# Polymarket US — Dynamic all-sport capacity (2026-10-16)

## Ownership (single system)

| Responsibility | Owner | Notes |
|---|---|---|
| REST discovery / roster archive | `functions/lib/polymarketCapture.js` → R2 `stream-roster/` via `polymarket-pages` / hourly collect | Only REST acquisition path for US gateway pages |
| Eligible contract registry + WS subscribe | `services/polymarket-us-stream` Durable Object `active-sports-fbis-v3` | One DO; no competing collectors |
| Signed WS handshake | Pages `/api/polymarket-stream-sign` + Worker proxy token | Private key stays in Pages |
| Observation persistence | Primary D1 when healthy; `MARKET_HISTORY_DB` recovery + R2 spill when primary `OVER_LIMIT` | Never counted as primary success when recovered |
| Optional history mirror | `MARKET_HISTORY_SHADOW_WS` (default disabled on stream Worker) | Post-commit only; not a second writer |

Retired: fixed `MAX_MARKETS=48` and six-contract-per-sport hard selection as the capacity architecture.

## Capacity model

- Soft ceilings via env: `STREAM_MAX_CONTRACTS` (500), `STREAM_MAX_PER_CONNECTION` (50), `STREAM_MAX_CONNECTIONS` (10), `STREAM_MIN_PER_SPORT` (1).
- Subscribe frames remain ≤50 slugs (`polymarketUsSubscribeBatches`); multiple frames on one socket under one DO.
- Fair round-robin across all 11 `STREAM_SPORTS`. Large CFB inventories cannot starve NFL/NHL/etc.
- Uncovered contracts reported with reasons; sports without inventory report `NO_VERIFIED_MARKETS`.

## Persistence contract

| Status | Meaning |
|---|---|
| `HEALTHY` | Primary D1 insert succeeded (`inserted` incremented) |
| `DEGRADED_HISTORY` | Primary D1 failed; recovery write to `MARKET_HISTORY_DB` succeeded (`historyInserted`) |
| `DEGRADED` | Primary D1 failed; R2 `stream-spill/` only (`spilled`) |
| `UNAVAILABLE` | Primary D1 failed and both history + spill failed; ticks re-queued |
| `UNVERIFIED` | No flush attempt yet |

## Delivery

| PR | Merge | Role |
|---|---|---|
| #1201 | `7487ab1e` | Dynamic capacity; retire 48-cap |
| #1204 | `28a9fd96` | History-shard recovery writes + forced `/start` rotate |
| #1205–#1207 | `d56ca04e` | DO v2→v3 cutover; health/start ownership alignment |

Worker deploy: `fbis-polymarket-us-stream` Version after #1207 deploy run `38965938073`.

## Production verification (2026-10-16 ~20:59Z UTC)

| Metric | Observed |
|---|---|
| Connection | `CONNECTED`, `streamHealthy=true` |
| Mode | `DURABLE_OBJECT_DYNAMIC_CAPACITY` |
| `fixedCapRetired` | `true` |
| `codeVersion` | `dynamic-capacity-history-recovery-20261016` |
| Subscriptions | **377** |
| Received / parsed | ~6,167 / ~6,020 |
| Primary `inserted` | **0** (primary D1 `OVER_LIMIT` ~10.00 GB) |
| `historyInserted` | **2,076** |
| `spilled` (R2) | **2,076** |
| `persistenceStatus` | `DEGRADED_HISTORY` |
| History readback (24h) | **3,628** BBO rows, **333** contracts, **60** matched events, last capture `2026-10-16T20:59:55Z` |
| `canAuthorizeWager` | `false` |

### Per-sport subscription coverage (eligible registry → active subs)

| Sport | Eligible contracts | Subscribed | Uncovered | Status |
|---|---:|---:|---:|---|
| NFL | 0 | 0 | 0 | NO_VERIFIED_MARKETS |
| CFB | 200 | 200 | 0 | HEALTHY |
| NBA | 12 | 12 | 0 | HEALTHY |
| CBB | 0 | 0 | 0 | NO_VERIFIED_MARKETS |
| NHL | 78 | 78 | 0 | HEALTHY |
| MLB | 0 | 0 | 0 | NO_VERIFIED_MARKETS |
| WNBA | 0 | 0 | 0 | NO_VERIFIED_MARKETS |
| Soccer | 87 | 87 | 0 | HEALTHY |
| Tennis | 0 | 0 | 0 | NO_VERIFIED_MARKETS |
| NPB | 0 | 0 | 0 | NO_VERIFIED_MARKETS |
| KBO | 0 | 0 | 0 | NO_VERIFIED_MARKETS |

Sports with zero eligible contracts have no verified Polymarket US + pre-event gate inventory at capture time — not silent drops.

## Remaining

1. Primary D1 remains `OVER_LIMIT`; primary `inserted=0` until approved compaction/retention frees headroom (no unqualified deletes).
2. `desiredConnections=8` vs `activeConnections=1` — multi-frame subscribe on one socket under one DO; additional sockets are optional capacity, not a second owner.
3. Unrelated Cloudflare Workers Builds (orchestrator / soccer backfill / market-probe) continue to fail on pushes; not part of this stream path.

## Safeguards retained

`canAuthorizeWager=false`, `canQualify=false`, research-only, independent pre-event projection gates unchanged.
