# FBIS × Polymarket US — Research Market Integration (October 2026)

## Scope
Primary operator-intent execution venues: Heritage Sports and Polymarket US.
No connection to authenticated Polymarket US account has been established by this code.
No exchange orders, trading permissions, wallet secrets or account sync.

**Polymarket US is not Polymarket International.** This collector ONLY queries
the public US gateway `https://gateway.polymarket.us`. International Gamma,
CLOB, Sports WebSocket and Data APIs need a separately labeled provider.

## Covered FBIS sport scopes
NFL, CFB, CBB, NBA, WNBA, MLB, NPB, KBO, NHL, Soccer, Tennis.
The collector discovers US sports leagues dynamically and labels each sport:
- `LEAGUE_UNLISTED` — no corresponding league found in the US API catalog
- `NO_SAME_DAY_MARKETS_LISTED` — league exists but our bounded sample found no date-matched events
- `SAMPLED_PARTIAL` — capped leagues, events, or markets; NEVER complete coverage
- `PROVIDER_ERRORS` — some league requests failed
- `RESEARCH_OBSERVATIONS` — at least some captured display-only market observations

All scope checks are independent of whether FBIS has a sport model or a usable
wager market. No market is NEVER equivalent to no scheduled games.

## Architecture
1. `GET /v2/leagues` public league discovery
2. `GET /v2/leagues/{slug}/events` US event/market and side discovery
3. Compare event identities to D1 `games`: **two verified teams and kickoff <=2 hours**
4. Persist every source observation to `normalized_market_observations` with
   `source=Polymarket US`, `source_type=exchange`, source IDs, capture timestamp.
   Unmatched observations keep null canonical_event_id and raw provider identity.
5. `/api/projections` reads fresh (<45min) matched observations *after*
   building independent FBIS projections, overlays display-only prices with
   explicit nonexecutable flags.
6. `GET /api/polymarket-status` reports captured/matched/unmatched evidence per sport.
7. Github Action `polymarket-us-market-collect.yml` captures hourly and
   saves an auditable, 14-day run artifact.

No `BET`, `can_qualify`, `can_authorize_wager`, promotion, unvalidated EV,
fake sportsbook American odds, or injected market-informed features.
Current `marketSides[].quote.value` is labeled **DISPLAY_REFERENCE_NOT_EXECUTABLE**
because a quote is NOT a timestamp-verified best ask. Raw bestBid/bestAsk is
preserved when supplied but must first be verified as outcome-specific before
using it for execution decisions.

## Phase 2 (NOT implemented)
- BBO per contract/market side and source timestamp validation
- Full market catalogue cursoring; league aliases for unmatched sources
- Order-book depth, per-leg liquidity, taker fees, impact, stale-state policies
- 1–5 minute streaming in-play capture (bounded provider subscriptions, not page polling)
- Polymarket US authenticated positions/activity import after explicit
  account authentication, preserving settlement receipts and hedge history
- Market-specific prospective SHADOW EV/CLV/economics and manual promotion.
- Separate Polymarket International collector where legally relevant.
- Price comparison with Heritage on precisely equivalent contract resolution rules.

Sources:
- https://docs.polymarket.us/api-reference/introduction
- https://docs.polymarket.us/api-reference/sports/get-events-by-league-slug
- https://docs.polymarket.us/api-reference/markets/get-market-bbo
- https://docs.polymarket.us/concepts/market-data
