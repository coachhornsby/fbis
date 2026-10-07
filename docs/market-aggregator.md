# FBIS Market Aggregator

## Authority
One independent FBIS projection feeds many market observations. Venue data does not alter the projection. The layers are projection → normalized offers → edge/economic calculation → existing sport governance.

## Normalized offer
`functions/lib/normalizedMarket.js` defines the shared representation for pick'em, sportsbook, and future exchange sources. Missing fields remain null. Threshold (`line`) and price (`americanOdds`, `contractPrice`, `payoutMultiplier`) are separate.

Fields include source/sourceType, sport/league, event identity/start, teams, player identity, market/stat family, side, line, American/decimal odds, contract price, payout multiplier, standard/alternate status, promo, period, source market/outcome IDs, fetchedAt, execution eligibility, and raw source payload.

## DraftKings
FBIS already had two working conventional-data paths that expose DraftKings:
- `functions/lib/sharpApi.js`: DK + FanDuel soft quotes.
- `functions/lib/theRundown.js`: DK + BetMGM + FanDuel, with Novig/Heritage identifiers also understood.

The aggregator reuses these feeds rather than adding a duplicate DraftKings HTTP client. `draftKingsAdapter.js` converts their The-Odds-style events or flat player-prop rows into venue-preserving normalized offers.

Game markets: moneyline, spread/run line, total. Player props are accepted only when the existing FBIS canonical sport mapping says the stat family is model-supported.

DraftKings observations are market references regardless of jurisdiction. `executionEligible` is a separate nullable/boolean field and is never inferred from source availability.

## Pricing
For conventional sportsbook offers, raw implied probability is calculated from American odds. When both sides of the same source/market/line exist, multiplicative no-vig probability is calculated. The aggregator stores raw implied and no-vig probabilities separately.

When a valid independent model probability is supplied, the offer can additionally expose model probability, fair American price, break-even probability, probability edge, and expected return per 1u risk. Probability edge and expected ROI are distinct quantities.

Pick'em offers do not receive fabricated American odds. They can express line advantage but not sportsbook EV unless a future explicitly modeled entry payout structure supports it.

## Threshold-aware model evaluation
`marketAggregator.js` accepts `model.probabilityAtLine({line,side,offer})` or a line-indexed probability map. Therefore 7.5 and 8.5 can receive different model probabilities from the sport distribution. A single fallback probability is used only when the caller explicitly supplies one.

## Shopping and diagnostics
Equivalent offers report best over threshold, best under threshold, best directly priced sportsbook offer by executable expected return, threshold disagreement, stale flags, outlier flags, and descriptive conventional implied-probability consensus.

A 2+ unit threshold discrepancy is `VERIFY_OUTLIER`, never an automatic stronger bet. The comparator returns `canQualify=false` and `canAuthorize=false`.

## Persistence
The normalized schema is snapshot-ready. Existing Underdog append-only logging remains intact. A later bounded persistence migration should add a common append-only market-observation store only after current production D1 lineage and retention requirements are reviewed; this phase does not create a new migration or alter production tables.

## Adding sources
Adapters should only fetch/parse venue-specific data and return normalized offers. They must not modify sport projections, calibration, thresholds, qualification, confidence, or wager authority.
