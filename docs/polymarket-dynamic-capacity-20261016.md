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

## Production blockers observed (pre-deploy of this change)

- Live Worker was **connected** with authentic ticks (`received` thousands) but `lastError=d1-bbo-persist-error` and `inserted=0` — primary D1 at ~10GB hard ceiling.
- This change adds R2 spill on persist failure; it does **not** cut over write ownership to `MARKET_HISTORY_DB` (gated separately).
- Full production acceptance still requires D1 capacity relief or an approved write-path cutover.

## Safeguards retained

`canAuthorizeWager=false`, `canQualify=false`, research-only, independent pre-event projection gates unchanged.
