# FBIS × Kalshi — sitewide wiring mandate and phased authority plan
**Date:** 2026-10-20  
**Status:** Phase 0 inventory + Phase 1 public Kalshi market shadow adapter. No execution cutover.  
**Owner:** FBIS; scope: NFL, CFB first; additional sports only after verified series/contract coverage.

## 1. The boundaries (non-negotiable)
1. **FBIS PURE / CORE** is an independently fitted prediction. Kalshi prices, Polymarket quotes and PinnOdds prices must not enter CORE prediction inputs unless an isolated research challenger is separately proven by walk-forward tests and explicitly approved.
2. **REFERENCE_MARKET:** PinnOdds remains independent sharp market benchmark. Never label Kalshi as PinnOdds or alter the existing FBIS/PINNODDS gap denominator.
3. **EXCHANGE_MARKET:** Kalshi and Polymarket US are separate executable-market candidates, not sportsbooks. Ask, available size, fees, trading status, settlement terms and provider observation time are distinct dimensions.
4. **EXCHANGE ACCOUNT:** Only the private ACCOUNTS UI (authenticated by FBIS_ACCOUNT_VIEW_TOKEN) may display balances, orders, positions and fills. No private account values in public cards, model APIs, My Bets public views, system health or analytics.
5. **MY BETS:** Actual Kalshi fills are exchange transactions, not automatically recognized FBIS model bets. Manual journal must remain intact; exact fills, order intent, fees, settlements, cash flows and identities must reconcile before auto-import or performance claims.
6. **NO AUTOMATED TRADING:** No order create/cancel/replace, withdrawals, deposits or automatic wager authorization. Explicit operator permission and risk policy review required before any future write operations.
7. **NO D1 STORAGE CUTOVER:** Kalshi shadow endpoints write no D1/R2. Primary/market-history databases are under capacity/migration constraints. Do not start new bulk market writes until archive, quarter routing, retention and sport DB shadow tests pass.

## 2. Verified FBIS code inventory (as of this audit)

| Surface | Existing implementation | Missing before authority |
|---|---|---|
| Public game sentiment | `functions/lib/kalshi.js` caches KXMLBGAME/KXNFLGAME/KXNBAGAME/KXNCAAFGAME public market reads; `src/App.jsx` exposes a Kalshi sentiment cell | Legacy fallback cent/dollar interpretation and loose fixture matching need hardening; sentiment ≠ executable quote |
| Private capital operations | `functions/api/kalshi-account.js`, `functions/lib/kalshiAccount.js`, `src/features/accounts/AccountsView.jsx` | User reports live balance works; validate ledger completeness/settled history separately |
| Private stream staging | `functions/lib/kalshiAccountStream.js` signs WS and defines channels | Durable Worker/DO host, reconnect, idempotent state and REST reconciliation not running |
| Game comparison | `functions/api/market-alternatives.js` combines PinnOdds + Polymarket US research, initially NFL/CFB | Exact Kalshi event binding, side/period/strike/settlement identity, top-of-book quote + fees and timestamp |
| Player props | `functions/api/player-props.js` uses Action, legacy PrizePicks feeds, mirror and PinnOdds | Kalshi per-sport/player/market registry, identity, line threshold, outcome and settlement parity; no auto promotion |
| Generic offer model | `functions/lib/normalizedMarket.js`, `marketAggregator.js` currently price expected ROI via American odds for sportsbook offers | Exchange purchase-price payoff, variable fee schedule, available notional/depth, side-specific break-even, non-standard contract settlement; never force into sportsbook ROI |
| My Bets / performance | `src/MyBetsView.jsx`; separate journal/actual wager ledger | Private fill -> decision -> settlement accounting crosswalk, not market-data joins based on team names |
| System and infra | Cloudflare Pages + Workers, D1 per-sport shadow work, R2 storage work | Capacity-aware persistence, telemetry, quote source clocks, delivery alarms, confidence/coverage by sport |

**Important:** Exactly four sport series are currently coded in legacy direct Kalshi: MLB, NFL, NBA and CFB. NHL, CBB, soccer, tennis and other FBIS sports do not automatically become covered just because the site displays them.

## 3. Phase 1 delivered in this PR: isolated market shadow
- `GET /api/kalshi-market-shadow?sport=nfl|cfb|mlb|nba`: fetch one bounded open market page by known series. Includes explicit incomplete-pagination indicators and raw-observation vs metadata clocks.
- `GET /api/kalshi-market-shadow?sport=nfl&ticker=<approved-market>`: fetch one market + its orderbook; no arbitrary external URLs.
- *Raw market list* provides YES/NO bid/ask fields, sizes, volume, open interest, contract rule excerpts, market and event tickers, and a fetched timestamp. Unit-safe dollars and legacy cents parsing.
- *Raw orderbook* provides YES/NO bids. Derive buy YES ask = 1 − best NO bid; buy NO ask = 1 − best YES bid. Preserve the opposing bid's actual size; do not use last trade or midpoint as fillable ask. Source: Kalshi orderbook API.
- Every returned offer is `SHADOW_ONLY`; `executionEligible=false`, `canQualify=false`, `canWriteMarketHistory=false`, `canPublish=false`, `canChangeProjection=false`, `canAuthorizeWager=false`.
- Timestamp caveat: `market.updated_time` is metadata update, **not** proof of quote source age; REST fetch timestamp is locally observed time, not a Kalshi exchange event clock.
- Zero DB writes, zero private credentials, zero model/board edits, no hidden bootstrap. A malicious `?mode=authoritative` or hypothetical env flag cannot change the output's authority.
- Defensive constraints: provider host pinned, allowlisted series/tickers, bounded JSON, GET-only, failures as explicit non-success, no raw provider errors logged.

## 4. Next phases and acceptance gates

### Phase 2 — event identity and exact-contract reconciliation (NFL → CFB)
- For each Kalshi ticker, independently match verified FBIS game ID + start time + home/away participants; inspect event title, contract side and settlement rules, not team string alone.
- Market family must be verified as `moneyline`, `spread`, `total`, or `player_prop` with exact period, line and side. Ambiguous games get `UNMATCHED`; never borrow another game's quote.
- Compare quote availability and scoreboards on at least 2 multi-day NFL/CFB windows. Keep a known-empty market state distinct from ingestion failure.
- **Acceptance:** zero known wrong event/side matches; per-sport timestamp and completeness receipts; no synthetic market prices or stale executable badges.

### Phase 3 — execution research display on BOARD / MARKET
- Only after Phase 2, add **Kalshi** beside **Polymarket US** and PinnOdds:
  - FBIS probability vs PinnOdds sharp reference (unchanged).
  - Kalshi YES/NO **buy ask** and actual top size, with independent observed timestamp, open/paused/closed state.
  - Gross `P(win) − buy_cost` research context must be labeled pre-fee, and net EV only with verified contract settlement ($1 vs variants), actual Kalshi fee tier, fillable size and liquidity.
  - If no complete paired quote or verified contract, show `Research only / Not executable`.
- BOARD quote components must **not** modify CORE predictions, stars/confidence, PinnOdds gap bar, automatic qualification, suggested wagers or publication until opt-in gated approval.
- Reconcile *Kalshi vs Polymarket US* only for identical event/side/period/line/settlement conditions. A nominal low cent price is not the best offer absent fee/depth checks.

### Phase 4 — verified player props and Combos/RFQ
- Build sport→Kalshi series registry and official player identities; map stat family, strict O/U threshold, full game vs partial periods, void/settlement rules.
- Start NFL/CFB first, then expand only on evidenced active Kalshi leagues; do not mark all 11 FBIS sports "covered" without market records.
- Correlated combos require exact component tickers, leg sides and payout/settlement mapping. RFQ responses are not standing book asks. Never imply any combo fill is available from a "trade tape" print.
- Compare against Polymarket US similarly, with separate market provenance. Historical PrizePicks prop records stay historical, not current execution authority.

### Phase 5 — private account stream and My Bets reconciliation
- Deploy dedicated authenticated Cloudflare Worker/Durable Object WS for fills, positions and orders with heartbeat, backoff, reconnect, sequence/dedupe and REST replay.
- Keep the user portfolio private in a separate authorization domain; no public cache headers.
- Import actual Kalshi fills to staging only after trade ID, market ID, entry time, action, fee and settlement reconciliation. Avoid double counting partial fills or correlated legs.
- Verified performance views: actual net return, projected-edge calibration, CLV, stake exposure and open risk by exchange and sport. Never equate Kalshi account balance delta with betting profit without funding reconciliation.
- Ledger writes only when destination database authority, R2 retention, historical access and idempotent recovery are proven.

### Phase 6 — optional manual trade UX; later, controlled execution
- Only after explicit approval, account entitlements, fee model, identity/contract gates, minimum liquidity, stop limits, daily risk budget and audit trail.
- No auto wagering implied by data feed availability.

## 5. Risk register / rollback
- **Wrong-side conversion:** Ask != last/mid/bid. Shadow parser and market quote tests must remain green.
- **Stale/unverifiable quote:** REST fetch timestamp != provider exchange timestamp. Display indicative only until WS source clock proven.
- **Sports identity collision:** Team-name-only match can contaminate card. No authority without fixture proof.
- **Private leak:** Public market endpoint never references `KALSHI_API_KEY_ID`, PEM secrets, `FBIS_ACCOUNT_VIEW_TOKEN`, account API, positions or fills.
- **Cross-exchange math:** Never add cash, asset notional or apparent per-leg odds into a combined "net worth" or combined wager EV without reconciled contracts.
- **Storage pressure:** No new D1 writes in Phase 1; fail closed on provider errors and absent market data.
- **Rollback:** New route and library can be disabled/removed independently; no data migrations, no changes to live CORE, account route, board or PinnOdds math.

## 6. Phase 1 operator acceptance
1. GitHub full CI (including `test/kalshi-market-shadow.test.js`) passes, production Pages deployed.
2. Unconfigured account credentials do not affect *public* shadow data; locked Accounts remains protected.
3. `/api/kalshi-market-shadow?sport=nfl` reports `governance.mode=SHADOW_ONLY`, series, observation time and only valid open market records.
4. `/api/kalshi-market-shadow?sport=nfl&ticker=<real ticker>` returns safe top-of-book diagnostics; invalid cross-sport tickers rejected.
5. No changes to board outputs, CORE model, player props, My Bets or market-history database.
6. Establish a 7-day NFL and CFB coverage baseline **before** any display-level feature flag is enabled.

## Sources
- Kalshi GET Markets: https://docs.kalshi.com/api-reference/market/get-markets
- Kalshi GET Market: https://docs.kalshi.com/api-reference/market/get-market
- Kalshi GET Market Orderbook: https://docs.kalshi.com/api-reference/market/get-market-orderbook
- Kalshi WS Orderbook Updates: https://docs.kalshi.com/websockets/orderbook-updates
- FBIS market role policy: `docs/market-roles.md`
- Existing account plan: `docs/kalshi-pro-account-build-20261020.md`

## 7. 2026-10-20 live Cloudflare observation — rate-limit blocker
After the Phase 1 production deployment, an unauthenticated, read-only NFL market-list request through FBIS returned provider HTTP **429**. This confirms route deployment, **not** live public-quote readiness. Cause (existing public sentiment pulls, provider-wide limit, Cloudflare egress, or other clients) is not yet proven.
- The public shadow adapter now returns explicit `KALSHI_PUBLIC_RATE_LIMITED`, `httpStatus=429`, optional bounded `retryAfterSeconds`, and **no fabricated or cached price**.
- User-facing requests must not initiate retry storms. Do not place the route in board-wide fanout or player-prop rendering.
- Next operational acceptance: inspect provider rate limit tier and current request volume; implement one controlled shared collector/scheduler with cache TTL and jitter, request budget and per-sport coverage; consider public WS subscriptions with verified sequence/reconnect for exchange clock. Measure sustained 200 responses, valid market counts and independent fixture identity before enabling display.
- A green unit test proves fail-closed contract behavior, not real provider quota resolution.
