# FBIS unified market — PinnOdds REST foundation (2026-10-13)

## Nonnegotiable source boundaries
- FBIS predictive outputs remain independent. PinnOdds is a **Pinnacle-sourced REFERENCE** book, **not** Pinnacle directly and never a configured Heritage execution quote.
- Polymarket US exchange public discovery and authenticated read-only Market WebSocket remain separate. International Gamma/CLOB is a distinct venue; no order submission.
- **PinnOdds: REST-only** `GET /kit/v1/prematch/fixtures`. **No WebSocket, SSE, new purchase, paid plan or API-key rotation.**
- Existing schedule, results, injury, play-by-play, personnel, ratings, and model feeds remain untouched.

## Initial audited production facts
- The existing `fbis-orchestrator` Worker has the encrypted `PINNODDS_API_KEY` secret; previously it had no `DB` binding. This slice adds a binding to the existing production D1 (not a new database).
- Cloudflare Pages already binds `DB` to `fbis`. `normalized_market_observations` exists from migration 0095.
- At audit time: `normalized_market_observations` had **zero PinnOdds** records; `odds_snapshots` retained historical **Pinnacle** entries. Do not conflate these.
- The Polymarket US research collector and signed-US-WebSocket implementation predate this slice. The international venue is not assumed to be the same.
- Legacy MLB/NHL free-odds workflows still exist and are **not disabled** in this phase. Their sportsbook readback is not replaced by unverified PinnOdds.
- Existing Worker cron pathways are mixed-purpose, including tennis recovery and NHL goalie shadow; none were retired.

## Provider contract
See https://pinnodds.com/docs and https://pinnodds.com/terms. Auth via `x-portal-apikey` header, never URL or logs. Provider trial limit: **100/day**, **100/hour**, **20/min**, UTC fixed-day boundary. This implementation reserves at most 80 routine, 20 diagnostic, 100 total, 19 per minute. Reservation is a single SQLite atomic conditional INSERT across Workers and includes failed calls and 429s. Retry-After blocks further reservations.

Use top-level `last` as the increment cursor, never event-level `last` as quote timestamp. Full reconciliation at least once per 24 hours (healthy board only), detecting disappeared provider event IDs; never deleting observations. Require `X-Data-Status=fresh`, `X-Data-Board=prematch`, `X-Data-Age-Ms` present and <=5 min before snapshot persistence. Status `stale`, `unknown`, 429 or wrong board fail closed. Board age is not event-level price timestamp; `source_observed_at` remains **NULL**.

## Identity and markets
Unique two-participant orientation and kickoff ±2h, plus sport-group match, are required before normalizing into the canonical ledger. Unknown or ambiguous provider fixtures remain in the **provider fixture-state table only**, not executable or attributed prices. `source='PinnOdds'`, `source_type='sportsbook'`, and `execution_eligible=0` are mandatory. Period, original provider event and league IDs, market family, threshold, and side survive. Soccer `moneyline_3way` is not merged with ordinary 2-way moneyline. No-vig/EV cannot be inferred from incomplete prices.

## Rollout gates
1. Merge only after test suite, Cloudflare Pages preview and independent review.
2. Run production migration 0101 before collecting. Confirm state/ledger tables and existing data remain intact.
3. Deploy orchestrator with **`PINNODDS_COLLECT_ENABLED='false'`**. Verify `GET /health/pinnodds` reports no requests, secret presence as boolean only, and read-only aggregate feed health.
4. Before enabling, verify provider free entitlement, no rate-limit conflict from any other consumer of the same key, real fixture response, correct header freshness, matching against FBIS schedule and batch D1 readback; document license scope and operational cost.
5. Only then flip collector flag in a separate reviewed change. Scheduler uses **three** fixed UTC slots per hour (72 theoretical daily calls maximum), prioritizes upcoming sports and stale coverage; D1 enforces hard caps globally.
6. Shadow-compare over full event/market-family windows with legacy. Preserve mismatches, unsupported leagues, unmatched events, and incomplete normalization as explicit blockers. No automatic authority promotion or odds collector shutdown.
7. Retire legacy sportsbook-only collectors solely after proven equal/better coverage and a reproducible rollback; **never** remove statistical source or historical odds.

## Operational endpoints
- Worker `GET /health/pinnodds`: credential **configured boolean**, quota, status; never leaks the secret.
- Authenticated Worker `POST /api/pinnodds/collect`: diagnostic free REST collection, gated behind explicit enablement and centralized quota reservation.
- Pages `GET /api/pinnodds-status`: read-only aggregate D1 source health and sport coverage.

## Rollback
Set `PINNODDS_COLLECT_ENABLED=false` and redeploy the orchestrator. Do not drop tables, mutate old observations, or delete legacy jobs. Never infer prospective CLV from `source_observed_at=NULL`.
