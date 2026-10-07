# Asian Baseball free-tier market collection

NPB/KBO market data is observational only. The independent Asian Baseball models remain projection authority; market observations cannot qualify or authorize wagers.

## Provider policy
The Odds API is **free-tier only**. No historical endpoint is used. Current sport keys are `baseball_npb` and `baseball_kbo`. The collector requests the three featured full-game markets in one call and explicitly limits the bookmaker set to at most ten so the request remains equivalent to one bookmaker region.

Current provider economics (2026-10-07): Starter advertises 500 credits/month. Current odds cost one credit per returned market per bookmaker-region-equivalent; therefore a response containing h2h, spreads and totals costs up to 3 credits per league. Empty responses do not consume quota. The provider response headers `x-requests-used`, `x-requests-remaining`, and `x-requests-last` are authoritative runtime telemetry.

FBIS does not hardcode a monthly Asian Baseball allowance because this subscription is shared. The collector persists remaining quota and fails closed at a small emergency reserve. Production scheduling must be chosen against observed shared usage; user-facing board loads must never trigger collection.

## Observation lifecycle
- `FBIS_FIRST_OBSERVED`: first valid observation FBIS captured. It is not claimed to be the bookmaker's true opener.
- `CURRENT`: ordinary prospective observation.
- `DECISION`: observation explicitly taken at a frozen FBIS decision.
- `CLOSE`: latest valid observation captured before scheduled/verified first pitch. A post-start CLOSE is rejected.
- `RESULT`: belongs in grading/economic records, not by mutating an observation.

All rows flow through `normalized_market_observations`. Bookmaker identity is the normalized observation `source`; raw provenance records provider=`theodds`. Pinnacle is only a `SHARP_REFERENCE_CANDIDATE` when actually observed. DK/FD/MGM remain soft-market references.

## Matching
Provider events are mapped to canonical `asian_baseball_games` by exact canonical team identity plus a bounded start-time check. Ambiguous or unresolved matches are not persisted. Doubleheaders therefore fail closed unless one canonical event is uniquely resolvable.

## Cadence
The collector gate backs off to six hours without a known near-term start, then tightens conceptually as first pitch approaches. This is a guardrail, not authorization for a fixed schedule. Because a full NPB+KBO cycle can cost up to 6 credits, no recurring schedule should be enabled until shared monthly usage and production credential availability are observed.

## Historical gap
There is intentionally no paid historical backfill. Prospective collection creates FBIS's own append-only history from deployment forward. Earlier market history remains unavailable unless a separately validated free source is added later.
