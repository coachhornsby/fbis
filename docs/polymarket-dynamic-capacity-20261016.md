# Polymarket US — Dynamic all-sport capacity (2026-10-16)

## Ownership (single system)

| Responsibility | Owner | Notes |
|---|---|---|
| REST discovery / roster archive | `functions/lib/polymarketCapture.js` → R2 `stream-roster/` via `polymarket-pages` / hourly collect | Only REST acquisition path for US gateway pages |
| Eligible contract registry + WS subscribe | `services/polymarket-us-stream` Durable Object `active-sports-fbis` | One DO; no competing collectors |
| Signed WS handshake | Pages `/api/polymarket-stream-sign` + Worker proxy token | Private key stays in Pages |
| Observation persistence | `persistNormalizedMarketBatch` → primary D1 | Fail-closed; R2 spill on persist failure |
| Optional history mirror | `MARKET_HISTORY_SHADOW_WS` (default disabled) | Post-commit only; not a second writer |

Retired: fixed `MAX_MARKETS=48` and six-contract-per-sport hard selection as the capacity architecture.

## Capacity model

- Soft ceilings via env: `STREAM_MAX_CONTRACTS` (500), `STREAM_MAX_PER_CONNECTION` (50), `STREAM_MAX_CONNECTIONS` (10), `STREAM_MIN_PER_SPORT` (1).
- Subscribe frames remain ≤50 slugs (`polymarketUsSubscribeBatches`); multiple frames on one socket under one DO.
- Fair round-robin across all 11 `STREAM_SPORTS` / `FBIS_POLY_SPORTS`. Large CFB/CBB inventories cannot starve NFL/NHL/etc.
- Uncovered contracts reported with `CAPACITY` / `CONNECTION_BUDGET` / sport `NO_VERIFIED_MARKETS`.

## Persistence contract

| Status | Meaning |
|---|---|
| `HEALTHY` | Primary D1 insert succeeded (`inserted` incremented) |
| `DEGRADED` | Primary D1 failed; identical ticks spilled to R2 `stream-spill/` (`spilled` incremented; `inserted` unchanged) |
| `UNAVAILABLE` | Primary D1 failed and spill failed; ticks re-queued |
| `UNVERIFIED` | No flush attempt yet |

Spill is recovery evidence only. It does **not** cut over write ownership to `MARKET_HISTORY_DB`.

## Production verification (live, pre-merge of dynamic Worker)

Captured from production Worker health + Pages status on 2026-10-16 (~20:26Z UTC):

| Metric | Observed |
|---|---|
| Connection | `CONNECTED` |
| Subscriptions | 24 |
| Received / parsed | ~9,000+ authentic WS messages |
| Inserted (primary D1) | **0** |
| `lastError` | `d1-bbo-persist-error` |
| Capacity fields (`fixedCapRetired`, `STREAM_MAX_*`) | **Not yet live** — PR deploy is dry-run only until merge to `main` |
| `canAuthorizeWager` | `false` |

### Per-sport coverage (production D1 REST/WS observations, 24h window)

All 11 sports reported `NO_RECENT_MARKET_CAPTURE` on `/api/polymarket-status` at verification time because primary D1 cannot accept new WS rows. Historical WS tennis rows exist from earlier captures (`bboRecordsLast24h` still reflects pre-ceiling inventory). Do **not** treat workflow success as coverage.

| Sport | Eligible games | Eligible contracts | Subscribed | Fresh | Uncovered | Status |
|---|---:|---:|---:|---:|---:|---|
| NFL | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |
| CFB | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |
| NBA | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |
| CBB | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |
| NHL | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |
| MLB | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |
| WNBA | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |
| Soccer | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |
| Tennis | UNVERIFIED | UNVERIFIED | ≤6 hist. | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |
| NPB | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |
| KBO | UNVERIFIED | UNVERIFIED | UNVERIFIED | 0 | UNVERIFIED | UNAVAILABLE (D1 persist) |

Live DO still selects 24 eligible contracts from primary D1 roster (`candidateDiagnostics.reason=ELIGIBLE_CONTRACTS`, `source=primary-d1`) and receives authentic ticks — subscription path works; durable primary write path does not.

## Blockers for full §16 acceptance

1. **Merge + Worker deploy** — `.github/workflows/deploy-polymarket-us-stream.yml` deploys only on `main` (PR jobs are dry-run). Agent has no Cloudflare API token locally; Cloudflare MCP auth timed out.
2. **Primary D1 capacity** — ~10GB ceiling; `inserted=0` until space is reclaimed via existing compaction/retention workflows (no irreversible deletes in this PR).
3. **Per-sport eligible inventory** — cannot be honestly filled as observed facts until dynamic Worker is live **and** primary writes succeed (or spill read-back is operator-verified).

## Safeguards retained

`canAuthorizeWager=false`, `canQualify=false`, research-only, independent pre-event projection gates unchanged.
