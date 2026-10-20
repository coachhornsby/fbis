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

## 8. Stage-2 wiring implementation (2026-10-20)
This release implements a **separate scheduled public collector**, not an authoritative Kalshi pricing feed.

### Scheduled capture
- Dedicated Worker `fbis-kalshi-public-collector`, config `wrangler.kalshi-public-collector.toml`, `*/15 * * * *` UTC.
- One fetch per cron attempt, alternating NFL and CFB existing research series. 429 forces at least one hour without new provider requests. Other upstream errors also trigger a bounded cooldown.
- Non-sensitive, sanitized public snapshots and collector health live in existing R2 `fbis-archive` under `kalshi/public-shadow/v1/`. **No primary or sport D1 writes.**
- `GET /api/kalshi-market-shadow?sport=nfl|cfb` now reads R2 in production; it must not make a new Kalshi request on a website page view. Full market list is bounded to one API page (80 records); incomplete pagination must be labeled. Stale/absent snapshots return explicit errors, not prices.
- `ticker=` top-of-book direct research remains blocked in R2 production mode until dedicated book capture is scheduled; no silent direct fetch fallback.
- Legacy market sentiment calls elsewhere remain outside the new collector's control. Those routes must be audited and consolidated before requesting an increased provider budget or advertising complete coverage.
- Cloudflare Dashboard / Worker deployment verifies build and public health only; a 429 can persist after a technically successful release.

### Site surfaces
- Market page has a separately user-invoked **Kalshi Market Research** module that displays source price/unit provenance and non-executable flags from collector snapshots.
- Player Props page has a **discovery gate** for Kalshi player markets and MVE/RFQ combos. It does not invent props, payouts, executable liquidity, EV or model confidence from unverified Kalshi markets.
- Deterministic fixture/market helper requires both named opponents, event ticker and independent provider kickoff time matching canonical start. It returns `sideVerified=false` even on accepted event identity, until exact payout/settlement/market terms are separately checked.
- Accounts returns an exact-fill-ID reconciliation audit for recent private fills; the unmatched count is not betting profit, not a tracked wager and not a verified lifetime ledger.
- None of the above changes the independently generated CORE projection, PinnOdds comparison, confidence stars, My Bets performance, private funds access, sportsbook execution flags or authorization.

### Incomplete operational acceptance
1. Verify the Worker cron actually runs in Cloudflare and can write its scoped R2 prefix.
2. Achieve healthy snapshots for NFL and CFB over multiple windows, with accurate market identity and temporal coverage; a prior provider HTTP 429 blocks this.
3. Build a complete, replayable contract-identity registry for the approved markets, then collect orderbook depth + verified fees/settlement before any executable comparison.
4. Provision a separate authenticated Durable Object private-stream runtime and copy API credentials securely as **Worker encrypted secrets**. Existing Pages encrypted secrets cannot be automatically read/transferred to a Worker. Until a stream is deployed and credentialed, the 60-second private REST snapshot remains authority.
5. Crosswalk actual Kalshi fills and settlement by immutable exchange IDs into a dedicated verified ledger after sport D1 / R2 retention safety and independent profit reconciliation are approved. The current private UI only exposes a diagnostic receipt; it never writes/changes My Bets.

Rollback: Disable the Kalshi Worker schedule and/or remove the Kalshi Market Research component; the R2-only public route returns an explicit not-ready status while the existing FBIS model/market/account operations remain unchanged.

## 9. Private account WebSocket Worker — staged, deliberately disabled
- Worker: `fbis-kalshi-private-stream`, config `wrangler.kalshi-private-stream.toml`, DO `KalshiPrivateAccountSession`, `*/5 * * * *` wake cadence.
- **Default: `KALSHI_PRIVATE_STREAM_MODE=disabled`**. No private account streams start and no signed API requests are made in this state. The public `/health` route reveals only connection state, not trade identifiers, fill counts, positions or balances.
- When expressly enabled and separately credentialed, the DO connects to the existing allowlisted Kalshi `fill`, `market_positions` and `user_orders` read-only channels; notifications only mark the account dirty and queue REST reconciliation, with a two-minute minimum reconciliation spacing. Reconnect alarms cannot replace a missed-event REST backfill.
- No D1/R2 history writes, order placement, cancellations or fund transfer endpoints; the WebSocket is **not** settlement or journal authority.
- After initial deployment, encrypted Worker Secrets must be independently configured under Workers & Pages → Workers → `fbis-kalshi-private-stream`: `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY_PEM1`. These values are held as Cloudflare Pages secrets today; the Worker cannot read those encrypted values from the Pages project's configuration.
- Only after credential provisioning, confirm a safe authenticated WS handshake and REST snapshot parity, then opt into `KALSHI_PRIVATE_STREAM_MODE=enabled` in the isolated Worker. Default-disabled releases/rollbacks must never overwrite a manually enabled state silently. Any future enabling workflow must preserve the credentials.
- **Not yet production connected:** The staging deployment proves isolation and health, not a live WS connection, complete event history, profit reconciliation or automatic My Bets settlement.

## 10. Post-deployment production hardening / monitoring
- `GET /api/kalshi-integration-health` reports R2 collector status, last verified attempt, per-sport freshness/coverage and outstanding qualification gates. The System dashboard displays those non-sensitive receipts; the route NEVER returns private balances, positions, fills or credentials.
- `functions/lib/kalshi.js` legacy direct fetcher is retired and cannot silently fetch up to eight pages on a customer refresh. Its old price conversion mixed legacy integer cents with dollar strings, and weak team matches were not kickoff/settlement verified. A missing/disabled sentiment is preferable to a false Kalshi probability on game cards. The central R2 research view is the supported replacement.
- `auditKalshiFillReconciliation` previously described every fill as unmatched when no FBIS journal was supplied. It now reports `JOURNAL_NOT_LOADED`, leaves match counts null, and the Accounts page honestly shows 'Not yet compared'. No profits, win rates or historical My Bets entries are inferred.
- Production observation from this session: collector and private-stream schedules and Worker bindings are registered, but R2 has no completed Kalshi public snapshot and the private stream is disabled with no separate encrypted Worker key. Full live pricing and private streaming **cannot** be claimed complete until their separate operational acceptance gates pass.

## 11. Exchange status is NOT market data health
The official Kalshi public `GET /trade-api/v2/exchange/status` reports `exchange_active`, `trading_active`, `intra_exchange_transfers_active`, optional resume estimate and optional per-index state. It does not prove a sports series has quotes, nor prevent HTTP 429 quota errors. It cannot authorize FBIS wagers.
- The central scheduled Worker samples exchange status **at most once per hour** into `kalshi/public-shadow/v1/exchange-status.json` in R2, completely separate from the NFL/CFB market snapshot receipt.
- Rate limiting or provider errors become `RATE_LIMITED` / `UNAVAILABLE` without a guessed trading flag. Repeated requests are withheld until the next hourly window.
- The public FBIS `/api/kalshi-integration-health` reads **only** that stored R2 record, never Kalshi per page view. It reports a last-reported state only for a recent, structurally valid provider snapshot. Older than 75 minutes => `STALE_PROVIDER_REPORT` with null status flags.
- The System dashboard presents the last-reported exchange and trading states beside **separate** 429 collector status. An active exchange does **not** clear collector cooldown or elevate a single contract's order book or FBIS wager permission.
- No new signing secrets, D1 persistence, account exposure, model changes, order handling, or automatic trading.
- Next verification: after Worker deploy, wait for the next scheduled poll and confirm `exchangeStatus.state` is recent, rate-limited, or unavailable. A successful deployment and mocked regression tests alone do not establish the live status response.

## 12. Immediate operator diagnostics for 429
Observed in production October 20, 2026: scheduled Kalshi NFL market GET returned HTTP 429, as did independent exchange-status GET; browser-rendering egress additionally returned HTTP 403 for exchange status. The collector clock, R2 writes and scheduler are healthy. This suggests access may be dependent on origin/authentication, but the exact limiting rule is still not proven.

To test **without waiting for the next cron**, use System → Exchange Integration Readiness → **Test Kalshi connectivity now**. Enter the existing FBIS private portfolio access code (not an API key) and choose NFL or CFB. The endpoint `POST /api/kalshi-connectivity-diagnostic?sport=nfl|cfb` is available only after comparing that access code in constant time. It makes exactly two bounded public-market GETs at the same fixed URL: the first anonymous, the second properly signed with the private Kalshi API key that is already configured in Pages. No response bodies, signatures, key values, account data or raw upstream headers are logged or returned. Results contain only HTTP status, fixed result code and interpretation.

Safety gates: an existing R2 receipt is returned during the next 15 minutes (best-effort global limit; R2 is not an atomic lock); when R2 is unavailable the probe fails closed. The probe **never** changes the ordinary collector's cooldown, market authority, CORE probabilities, PinnOdds gap, journal, or wagering permissions. A 200 only verifies the provider returned HTTP success for that fixed request; it does not prove that the JSON shape or markets are usable or that bid/ask prices are executable.

Interpretation:
- Anonymous 429 + signed 200: access differs with API authentication. Safely provision credentials for a separately scoped scheduled market collector and rerun source/coverage and identity tests. Do not automatically promote prices.
- Both 429: shared read-bucket, origin/IP, or policy limiting remains possible; inspect Kalshi account tier, cost and support diagnostics before further retries.
- Anonymous 403 + signed 200: edge or anonymous access restriction; authenticated scheduled collector may be viable after explicit credentials scoping.
- Signed 401/403: reject key/signature/entitlement for market GET despite portfolio balance access.
- Both 200: collection query works from Pages execution; investigate differences between scheduled Worker and Pages egress, connector coverage and downstream data parsing.

## 13. Authenticated market-data relay — signed Pages, Worker scheduler
The operator's production diagnostic at 07:29 CT, October 20, 2026, established that
`GET /trade-api/v2/markets?series_ticker=KXNFLGAME&status=open&limit=1&mve_filter=exclude`
returns **429 anonymously** and **200 with the existing signed Pages credentials**.
The HTTP 200 confirms connectivity, not correctness of prices or full market coverage.

Architecture: the public scheduled Worker sends a POST to one protected Pages endpoint,
`/api/kalshi-collector-internal?scope=markets&sport=nfl|cfb`, using a unique
randomly provisioned `FBIS_KALSHI_RELAY_TOKEN` service secret. Pages already holds
`KALSHI_API_KEY_ID` and `KALSHI_PRIVATE_KEY_PEM1`; only Pages signs the allowlisted
`GET /markets` and `GET /exchange/status` requests. Signing uses the path without
query parameters. The response is normalized to the existing shadow schema, and
Pages writes ONLY public market observations and safe operational receipts to
R2. The scheduler does not receive Kalshi headers, secrets or account information.
No credentials are moved out of Pages.

The signed market collector keeps a 15-minute global guard, applies an hourly
backoff to signed HTTP 429 and preserves the existing NFL/CFB alternating
15-minute schedule. Signed exchange status is sampled hourly, with its own
rate budget. The Worker has no anonymous fallback; absent/mismatched service
token is shown as `CONFIGURATION_REQUIRED` or relay denial, never as a
provider quote. Neither path issues private portfolio calls or any trading POST.
The internal route is POST-only, refuses unauthorized callers, strictly gates
scope and sport, and cannot be used for arbitrary URLs. R2 market snapshots
remain shadow-only (no CORE, quote-qualification, bets, history or settlement
authority), including when the source returns HTTP 200. Production acceptance
requires successful signed 80-row NFL and CFB captures, normalization, freshness
and coverage checks. A successful mock CI job alone is insufficient.

## 14. Bounded signed multi-page collection
The signed Pages-to-Kalshi relay recovered its first authenticated CFB market
snapshot at 2026-10-20T12:45:24Z: 80 normalized market rows in R2, with
`paginationComplete=false`. This proves source connectivity and R2
persistence, **not** an exhaustive CFB inventory.
The collector now follows cursor pages sequentially, up to **4 pages × 100
markets** in each scheduled sport capture. It deduplicates exact Kalshi market
tickers, validates cursor shape and repeated cursors, reports pages fetched
and invalid market rows, and never publishes partial rows if a later source
request returns 429, malformed JSON or an invalid cursor. A successful capped
capture with a remaining cursor is explicitly marked `paginationComplete=false`.
The R2 research reader accepts at most 400 rows; the website currently displays
the first 24 with a visible count of the complete collected inventory.
This remains a research-only inventory, not validated settlement, orderbook
depth, fee-adjusted EV, or live cross-sport coverage. Expanding market scope
beyond NFL and CFB requires separate series/contract qualification.

## 15. Authenticated collection coverage and sport-series discovery
On October 20, 2026 the operator's NEW NFL diagnostic returned
anonymous HTTP **429** and signed HTTP **200**. This is expected:
only the signed collector path is supported; repeated anonymous comparison
does not measure live FBIS quote health.

Independent live R2 acceptance recorded:
- NFL: **56** signed `KXNFLGAME` markets at 2026-10-20T13:00:25Z,
  `paginationComplete=true` for the *queried game-winner series*, not for
  all NFL markets or props.
- CFB: **80** signed `KXNCAAFGAME` markets at
  2026-10-20T12:45:24Z, `paginationComplete=false`.
- Both are public shadow only, never CORE/EV/fees/executable authority.

Kalshi's official `GET /markets` documentation permits **up to 1000 records
per page**. The Pages collector now requests 1000 (previously 100) and follows
a bounded four-page cursor window, up to 4000 observed markets per sport
attempt. Cursors still determine whether the provider's query was fully
enumerated; no arbitrary 4000 cap may be described as complete. Existing
stale rules, safe failure of later pages, matching, source timestamps,
fees and execution guards remain in force. Large R2 snapshots can be read
up to 4000 rows; the Market page still renders an initial research subset.

For broader sport coverage, a separate signed daily
`GET /series?category=Sports` discovery request is now scheduled and
cached under `kalshi/public-shadow/v1/series-catalog.json` with a
`series-catalog-status.json` receipt. Responses are sanitized: ticker,
title, categories and tags only, up to 3000 candidates. Only signed GETs;
no private data or URLs/settlement claims are ingested. On 429 or malformed
responses the existing catalog is preserved and further discovery waits
at least six hours; healthy catalog discovery is due every 24 hours.
A Kalshi series returned by the catalog is **NOT** automatically mapped to
an FBIS sport, enabled as a collector, assumed to have currently open markets,
or eligible for pricing/execution. Explicit sport/league/contract settlement
mapping and fixture-level verification must precede activation.

The System page reports discovered series separately from verified
NFL/CFB game market collection, and explains why an anonymous diagnostic
429 is no longer a signed-source outage. Other Kalshi sports, markets,
player props and combos remain unqualified until real catalog evidence
and independent match/fee/orderbook validation are implemented.

## 16. Retire the anonymous operator request
The original operator A/B diagnostic established anonymous NFL market GET
returns HTTP **429** and signed GET returns **200**. The production signed
collector subsequently recorded valid, unqualified market snapshots for
NFL and CFB. Running an additional anonymous provider request on every
operator test is no longer useful and can aggravate provider-side rate
limits.

The operator diagnostic now sends exactly one signed GET to the fixed
allowlisted market source, with the same existing private FBIS access-code
gate and 15-minute global R2 cooldown. The former anonymous result is
reported as `DISABLED_BY_POLICY` and never fetched. Historical receipts
are normalized on read so a cached anonymous 429 can no longer appear
as a new production failure. An HTTP 429 on the **signed** GET remains
a real provider rate-limit blocker and is reported as
`SIGNED_RATE_LIMITED` without auto retry. Only signed source health
is considered operational; HTTP 200 alone still does not prove contract
identity, fee-adjusted execution, or full-sport market coverage.

## 17. Series catalog v2 completeness and signed relay failure receipts
The first production `GET /series?category=Sports` returned **4,014**
Sports series templates at 2026-10-20T13:15:24Z. The initial 3,000-row
catalog cap was therefore incomplete. V2 increases the bounded research
cap to 7,000 and forces one upgrade refresh even when the prior 24-hour
cooldown has not expired, then restores the daily schedule. V2 records
`version:2` in its operational receipt and never promotes new series
to a validated sport, game, player prop, combo, fee or wagering input.

The initial four-page/1,000-per-page market collector also exposed an
observability gap: Pages relay transport errors were not persisted by
the scheduler, allowing an older CAPTURED R2 health receipt to appear
as though a new scheduled attempt succeeded. The scheduler now stores
`RELAY_ERROR` with the fixed safe failure code and attempt timestamp
when Pages transport, receipt validation or upstream relay HTTP fails.
The last successful market snapshot is preserved but is governed by
its own timestamp and freshness rules; errors do not fabricate a
provider HTTP 429. Signed actual provider errors are still written by
Pages and retain their own cooldown.

## 18. Searchable provider Sports-series directory
The System view now includes **Explore Available Market Series**, which
reads from `GET /api/kalshi-series-catalog?q=&offset=&limit=` on R2
only. It can list and search signed-discovered Kalshi Sports series by
ticker, provider title, tag or category, with strict server pagination
(max 50 series per response). The static directory does not trigger
Kalshi requests from visitors and does not expose signing secrets,
fee claims, raw account records or private positions.
Series title/tag discovery is NOT a validated mapping to FBIS canonical
leagues, fixtures, player stat markets or settlement terms; nothing
in the explorer changes CORE, market authority, trading or My Bets.
This enables evidence-based review of source coverage, rather than
guessing provider tickers for 11 FBIS sport databases.
