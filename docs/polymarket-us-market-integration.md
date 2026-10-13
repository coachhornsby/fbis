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

## Authenticated US market WebSocket — first bounded phase

Runtime-only Cloudflare Pages production secrets:
`POLYMARKET_US_KEY_ID` and `POLYMARKET_US_SECRET_KEY` (both `secret_text`).
No API keys, secret bytes, signatures or private account data are put in GitHub,
logs, D1, public JSON payloads, build output, or browser bundles.

- Auth: Ed25519 signature of `timestamp + GET + /v1/ws/markets` with the
  32-byte private seed from the developer-portal 64-byte base64 key.
- Endpoint: `POST /api/polymarket-ws-capture`, requires existing HARVEST_SECRET
  server-to-server authorization (not usable from ordinary browser clients).
- Behavior: bounded **six-second** MARKET_DATA_LITE observation of a sampled
  eight-contract universe from the existing public collector.
- Persistence: append-only `normalized_market_observations` source
  `Polymarket US WebSocket`, captured-at timestamp, verified book BBO quote,
  spread/depth, provider and canonical event IDs when known.
- Limitations: best ask is a **read-only observed book price, not a guaranteed
  fill**. Market data remains unqualified with `canAuthorizeWager=false`.
- Public operational status: `GET /api/polymarket-status` shows only whether
  credentials are configured and whether any BBOs were saved in 24 hours.
  It never returns authentication material.
- Scheduler: existing hourly Polymarket collector runs this additional
  authenticated BBO step after the publicly accessible market discovery.

This is NOT an always-on socket, full exchange order book capture, full-market
historical replay, private account reconciliation or automated trading.
A dedicated durable streaming service and prospectively validated model
challengers remain future phases. Never claim this short sampler is a persistent feed.

## Durable streaming and private account read-only reconciliation (Phase 2)

### Market stream
`wrangler.polymarket-us-stream.toml` deploys an isolated Worker with one
Durable Object coordinating a rotating, reconnecting outbound US Market WebSocket.
Its every-five-minute Cloudflare Cron reactivates the object after deploys or outages.
The object rotates every 9 minutes, refreshes the live contract subscription,
uses a round-robin sport sample (up to 48 active contracts), deduplicates/throttles
quotes, and batches up to 40 immutable source-labeled records per write cycle.
This is a persistent, self-healing *bounded-scope stream*, not exhaustive
exchange coverage. All 11 sports are eligible; some may be unlisted on the US exchange.

The Worker stores **no copy** of the operator's Polymarket US signing key.
It holds one separately generated encrypted inter-service token,
`FBIS_STREAM_PROXY_TOKEN`, paired with `POLYMARKET_STREAM_PROXY_TOKEN`
in the existing Pages secret store. The Worker POSTs only to the protected
`/api/polymarket-stream-sign` endpoint, which issues a short-lived Ed25519
signature restricted to `/v1/ws/markets`. The source repository contains
neither the operator's signing key nor the inter-service token. Worker `GET /health` publishes only
aggregate counts and never allows credentials, account data or trading controls.
Market data and captures are research-only and cannot qualify a wager.

### Private account (explicit operator authorization)
`POST /api/polymarket-private-sync` is a server-to-server endpoint requiring a
valid existing secret in an HTTP header; no GET and no browser account endpoint.
It requests only three allowlisted **GET** paths on the authenticated US API:
- `/v1/portfolio/positions`
- `/v1/portfolio/activities`
- `/v1/account/balances`

Account balances are checked for accessibility, not returned to the caller or
saved; sensitive bank/destination records are not stored. Position and trade/
resolution summaries are sanitized and persisted only in isolated private D1
tables under migration `0100_polymarket_us_private_read_only`, with page cursors,
source IDs and no automatic grading, public balance view or wagering rights.
The API key itself may retain trading privileges: **this integration limits its
own code to allowlisted GETs, it does not change the privileges of the key at
Polymarket**. No automated order functions are imported or allowed.

The hourly private sync is separate from market streaming. Phase 3 will add
private WebSocket events, authenticated operator review workflows and a
reconciliation gate for bookmaker/exchange settlement receipts, plus
prospective economics for individual markets. Do not promote models or infer
profitability from market ingestion alone.
