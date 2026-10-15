# FBIS × POLYMARKET US — COMPLETE MARKET FLOW INTELLIGENCE BUILD MANDATE

**Execution target:** ChatGPT Work or another repository-connected engineering agent; deliver bounded, testable PRs rather than theoretical mockups.  
**Status:** Proposed engineering prompt, not implemented.  
**Date:** 2026-10-15  
**Repository:** coachhornsby/fbis  
**Production reference:** https://fbis-myz.pages.dev  
**Operating charter:** docs/FBIS-PROFIT-FIRST-FREE-FIRST-ROADMAP.md  
**Hard financial constraint:** $0 in incremental recurring costs without explicit CEO approval.  
**Trading control:** Read-only market observation and research signals. No exchange order placement, wager authorization, automatic promotion, or risk-rule changes.

## PRIMARY MISSION

Fully utilize the legitimately accessible Polymarket US market-data capabilities as FBIS's independent exchange intelligence layer across every supported sport and available market family. Create a durable, auditable, low-cost market-data and order-flow system that produces:

1. **Market Probability Movement** — attractive, responsive time-series and direction indicators showing how observed market probability/price changed over selectable windows.
2. **Observed Flow Signal** — data-grounded BUYING PRESSURE / SELLING PRESSURE / BALANCED / MIXED / INSUFFICIENT DATA, derived from correctly classified trades plus supporting book/price context.
3. **Flow Analysis** — aggressive YES-buys versus YES-sells, trade counts, share/contract quantities, size distribution, verified monetary notional when supported, liquidity changes, order-book imbalance, and large-trade events.
4. **Potential Sharp Activity** — a transparently explained, explicitly *inferential* research score/flags when price-leading, unusual, sustained, repeated, cross-venue, or otherwise predictive trade-flow patterns occur; never claim identified professionals, private wallets, or sportsbook sharp-betting percentages.
5. **Market Odds & Fair Value** — actual time-stamped Polymarket US bids/asks/size, converted American odds, separate contract-side pricing and spread, current FBIS independent fair probability, PinnOdds no-vig market benchmark, and fee/slippage-adjusted *research* EV subject to authority gates.
6. **Cross-Sport Alpha/Flow Screener** — rank realistic market opportunity research by price, statistical confidence, liquidity, time-to-event, data quality, source access, and expected profit at allowable size; a flow signal by itself is not a betting recommendation.
7. **Prospective learning** — determine, with temporally honest snapshots, which flow regimes actually predict subsequent executable price movement and/or outcomes, and which produce positive net simulated economics out of sample.

The goal is not an attractive dashboard without trustworthy inputs. The goal is to improve sustainable net betting returns at minimum infrastructure cost.

## STOP AND VERIFY THE REAL SYSTEM FIRST

Inspect main plus current production deployment SHA, health, workflows, D1 tables/limits, model registry, and current Polymarket US provider entitlements. Do not rely on this prompt or an old README as proof of current runtime health. Reuse, repair and extend existing code wherever possible, especially:

- services/polymarket-us-stream/worker.mjs, core.mjs and wrangler.polymarket-us-stream.toml
- functions/lib/polymarketUsSignedWs.js
- functions/api/polymarket-{collect,status,ws-capture,stream-sign,private-sync}.js
- functions/lib/marketObservationLedger.js
- docs/polymarket-us-market-integration.md
- canonical observation/economic cohort systems, PinnOdds provider, game and matchup UI, CI and migration tooling

**Current code inspection checkpoint:** a bounded persistent Durable Object service selects up to 48 contracts, cycles/rotates its connection, and requests full market data. A helper truncates subscription lists to 50, below the documented provider limit of 100 per subscription. The current parser reduces full market snapshots mostly to top bid/ask and does not retain full ladder, market stats, or separately subscribed trade prints. Treat these as code observations, not evidence that the deployment is online or healthy. Resolve any current code-versus-doc discrepancies with realistic fixture tests and real response samples.

First produce a **current state and compatibility report** documenting actual observed fields, source timing, available sports/markets, active signed connection, message rates, working subscriptions, trade coverage, limitations, D1 capacity, and incremental dollar cost.

## PROVIDER BOUNDARIES

**Polymarket US:** wss://api.polymarket.us/v1/ws/markets; requires signed authentication. Use its documented SUBSCRIPTION_TYPE_MARKET_DATA (book and market stats), SUBSCRIPTION_TYPE_MARKET_DATA_LITE (lightweight prices), and SUBSCRIPTION_TYPE_TRADE (trade prints). Official docs: https://docs.polymarket.us/api-reference/websocket/markets.

**Polymarket International:** not the same contract, API, account, settlement, jurisdiction, or endpoint. Never mix its sports WebSocket, international CLOB, Gamma or wallet features into a US provider data set. A separate future legally appropriate adapter may be proposed, not silently added.

**PinnOdds:** separate sharp benchmark, not a Polymarket price. Use only verified time-compatible Pinnacle quotes from the existing approved acquisition route. Verify contract settlement, overtime/regulation, side, period, line, timestamp, and event mapping before comparison.

**FBIS model:** keep independent model probabilities upstream of all market features. Market-aware challengers must be separately versioned, SHADOW-only until governance authorizes them.

## PHASE A — FULL MARKET DATA AND TRADE CAPTURE

1. Add dedicated parser(s) for MARKET_DATA, MARKET_DATA_LITE, and TRADE envelopes; handle snake_case/camelCase versions only when confirmed by docs/fixtures. Normalize book arrays (bid/offer px, qty), stats (lastTradePx, sharesTraded, openInterest, highPx, lowPx), market state, transactTime, tradeTime, price, quantity, maker/taker side and intent when available. Preserve original source meaning and units.
2. Define canonical identity key including provider, contract/market slug, event mapping, market family, side/outcome, line, period, and settlement rules. Do not blindly assume YES/NO structure matches sportsbook outcomes. Polymarket US uses a single instrument with YES/NO position intents; map taker intention and order side correctly before classifying directional pressure.
3. Subscribe to actual TRADE messages in addition to full market data. Preserve unique trade identifiers *only if the provider actually supplies them*; otherwise define a documented collision-aware fingerprint, exactly-once-within-scope best effort and provenance. Never double count maker and taker legs as two trades.
4. Retain raw payload manifests/checksums in R2 when quotas permit; retain compact canonical event/quote/trade facts and aggregates in D1. Keep source timestamp, receive timestamp, normalized timestamp, flush timestamp and data-source/version. Event time is not necessarily receipt time.
5. Book is a level snapshot/update, not transaction volume. Depth is resting orders that can cancel. 'sharesTraded' is cumulative; deltas require monotonicity, period, reset/disconnect validation. Open interest is not cash inflow. Resolve quantity types/units using provider schemas; never present fabricated USD flow from an unverified quantity unit.
6. Handle market pauses, state transitions, crossed/empty books, zero depth, duplicates, out-of-order frames, reconnects and stale quotes explicitly. For suspended/expired states, preserve state-change evidence while suppressing executable-price research.
7. Respect documented market subscription caps (100 per subscription), permissions, and source throttles; multiple subscriptions only after bounded quota/cost tests. Expand beyond existing 48/50 hardcaps *only if* measured server cost, memory, writes, and message rates remain within free budget. Prioritize markets with sufficient volume, valid identity, approaching events, active games, or approved sport research.
8. Provide a read-only health/control surface covering subscribed versus catalogued markets, trades/sec, quotes/sec, parse rejects, latency percentiles, observed sequence gaps, reconnects, backlog, D1 writes, active state, and source freshness. Unknown coverage must never be shown as full coverage.

## PHASE B — RESEARCH SIGNAL DEFINITIONS AND MATH

Define each signal with explicit denominator, unit, source, lookback, minimum sample/coverage and reason codes.

**Market Probability Movement:**
- chart separately: latest traded price, midpoint (indicative), best bid, best ask, and FBIS independently modeled fair probability when valid;
- selectable 1m, 5m, 15m, 1h, since open, and live-event intervals if enough data exists;
- compute movement in *percentage points* for price-implied probability and in *cents* for contracts; 0.52 -> 0.57 is +5pp / +5 cents, not '5% return';
- provide first/last timestamp, sample count, high/low, quote age, spread, market state, and actual price/side used; no fabricated carryforward after gap without clearly labeling interpolated display.

**Observed Flow Signal:**
- derive one and only one taker/aggressor direction per valid public trade; if maker/taker intent or trade unit cannot be safely mapped, record UNKNOWN and exclude from directional ratio;
- calculate buy-initiated and sell-initiated quantity and validated USD notional over rolling windows, trade counts, large-trade contribution, and buy share / sell share of **classified aggressive traded activity**;
- order-book imbalance = sum of qty at documented matched levels on one side relative to sum of both sides; show measurement separate from executed flow;
- calculate signed net taker flow, intensity against market baseline, price confirmation/divergence, and persistence; label BUYING PRESSURE, SELLING PRESSURE, BALANCED, MIXED or INSUFFICIENT DATA; signal and reason codes should match actual evidence;
- a trade always has counterparties, so '72% buys' means 72% of classified *taker-initiated* volume was buying YES, **not** that 72% of bettors or all money bet is on YES.

**Flow Analysis:**
- separate components for aggressive YES purchases/sales, counts, share quantities, verified USD trade notional, largest prints, rolling totals, big-trade percentile, spread, depth at target order size, bid/ask liquidity and trend;
- never portray resting orders as completed tickets or order book depth as cash already bet;
- chart price/flow divergence (large buying yet price fails to rise), absorption, replenishment, unusual cancellations as hypotheses only and with confidence/limitations;
- enforce positive denominators, source volume completeness, provider unit controls, no duplicate trades, and robust handling of quote/trade time alignment.

**Potential Sharp Activity — research only:**
- features can include exceptionally large trade vs same-market rolling distribution, repeated aggressive purchases, price-leading bursts, sustained signal after normalizing for volume/time, book imbalance preceding price change, Pinnacle agreement/disagreement after genuine timestamp and contract alignment, and predictive persistence in prospective evidence;
- DO NOT present 'sharp money', 'whales', professional identity, insider identity, verified handle split, or ticket count as facts without a separate lawful and verified source;
- display **POTENTIAL INFORMED FLOW — UNVERIFIED**, with score, evidence bullets, underlying raw metrics, sample size, calibration and limitations; use INSUFFICIENT DATA rather than a confident score when coverage is weak;
- develop weighted scoring as an explainable challenger, *not* an arbitrary production gate. No 'sharp' threshold is automatically authoritative.

**Economic edge analysis:**
- candidate YES and NO executable prices based on correct US instrument semantics; compute American-odds conversion and take price from bid/ask/ladder for actual intended action;
- fee schedule versioned/effective-date aware: include price-dependent US taker fee, size, maker rebates only if applicable and current, specialty market fees, risked capital, slippage and potential partial fills;
- estimate implied probability from observed prices but never equate that price to objective true probability;
- simulate ladder fills up to size and show quantity available, volume-weighted fill, max acceptable price, net model EV, edge interval and limits; stale/unavailable => NO TRADE RESEARCH;
- calculate no-vig Pinnacle benchmark separately where comparable and fresh; do not back-solve Pinnacle into the independent model;
- respect FMIS bankroll/exposure/staking rules; never silently turn an estimated edge into a recommended or executed wager.

## PHASE C — D1/R2 CONTRACTS, COST, RETENTION

Design additive, versioned migrations that preserve existing canonical tables and current sport projections. Introduce normalized schemas or compatible tables for:
- market catalogue and provider-to-canonical identity, market status and rules;
- full book snapshots or compact best-N depth levels;
- public trade observations with verified direction/units and dedupe lineage;
- aggregated 1m/5m/15m/1h flow bars plus freshness/coverage indicators;
- probability movement and book/trade signal evaluations;
- immutable research opportunities and contemporaneous market/model evidence;
- feature definitions, validation cohorts and economic outcomes;
- ingest health, data loss and per-provider cost usage.

Storage policy: prioritize meaningful changes, active markets, high-signal trades, threshold-based snapshots, and cheap rollups. Avoid permanent 1-second × all-market rows in D1. Use R2 for compressed cold raw events within free limits and documented retention. Index by provider/market/time/event. Idempotent writes and migrations, bounded transactions, backpressure, transparent data gaps. Never run acquisition loops that accidentally spend paid credits.

## PHASE D — UI: PREMIUM MARKET INTELLIGENCE, READABLE ON EVERY GAME CARD

Keep current FBIS team/player cards, identities, branding, approved layouts and sport navigation. Add progressive disclosure; do not overwhelm compact matchup cards.

**Compact all-sport matchup/ticker module:**
- prominent Market Probability Movement: arrow, start -> current implied %, movement in pp and selected time frame, with freshness badge;
- prominent Observed Flow Signal: directional arrow + BUYING PRESSURE / SELLING PRESSURE / MIXED / BALANCED / INSUFFICIENT DATA, with evidence count;
- **clarity-first Flow Analysis**: replace the ambiguous combined 72%/28% split bar with **two separate horizontal bars on the same 0–100% scale** labeled "Aggressive YES buys" and "Aggressive YES sells"; show the percentage to the right of each, a plainly worded top-line result ("BUYERS ARE MORE AGGRESSIVE" / "SELLERS ARE MORE AGGRESSIVE" / "MIXED" / "INSUFFICIENT DATA"), the lookback, verified volume unit, and classified sample coverage;
- Polymarket US best executable ask and equivalent American odds, FBIS independent fair %, plus Pinnacle benchmark only when verified;
- freshness/market-state, market family, source and gap indicators; never paint all empty values as zero.

**Expanded Flow Analysis panel (click through to game/market workspace):**
- large responsive Market Probability Movement time-series chart with bid/ask spread band, last trade, price change by 1/5/15/60 minutes, and separately distinguished FBIS fair % and verified Pinnacle no-vig reference;
- Observed Flow Signal card with label, confidence/sample and supporting factors (aggressive flow, book changes, price confirmation, source coverage);
- paired aggressive buying/selling bars (same 0–100% scale, **no stacked split bar**), directional net flow and its exact denominator, large-trade timeline, trade prints, and liquidity gauge;
- top-of-book plus depth ladder, cumulative size and estimated impact; market-state, quote age, source event clock and reconnect/data-gap markers;
- 'Potential Informed Flow — Unverified' section with transparent reasons and an option to open the underlying prospective evidence; never imply bettor identity;
- candidate research valuation: fair-vs-executable-price, fees, ladder-fill sensitivity, valid market match, uncertainty, and qualified/manual versus shadow eligibility;
- visible filters by sport, market family, pregame/live, signal direction, strength, liquidity, sample sufficiency and quote freshness.

**Visual acceptance specification — clean, plain-English Flow Analysis (illustration only):**

```text
FLOW ANALYSIS                        LAST 15 MIN · EXAMPLE
BUYERS ARE MORE AGGRESSIVE
72% of classified traded shares were initiated by YES buyers

AGGRESSIVE YES BUYS                 72%
██████████████░░░░░░
AGGRESSIVE YES SELLS                28%
██████░░░░░░░░░░░░░░

MARKET PRICE MOVEMENT
Last traded price: 51¢ → 57¢       +6¢ (+6 percentage points)
Observed direction: PRICE ROSE

WHAT THIS MEANS
More classified trade quantity was buyer-initiated than seller-initiated
during this window. The observed market price also increased.
It does NOT mean 72% of bettors, tickets, or all money were on YES.
It does NOT establish sharp-money or future-outcome certainty.
```

**Visual rules:** Place conclusion first, followed by two *independent aligned bars*, followed by price movement in a separate row, followed by a one-sentence explanation. Never combine price trend and traded-flow percentages into one unclear bar. Avoid showing both a BUYING PRESSURE badge and a second contradictory implied direction without explanation. Keep percentage labels visible without relying on color; one accent color for aggressive buys and a distinct muted neutral for sells, with accessible labels and sufficient contrast. Source and time window must be prominent. When no valid classified trades exist, show **INSUFFICIENT TRADE DATA** instead of a guessed percentage or default 50/50. Selected side may be YES/NO or an appropriately mapped outcome, but the denominator must always be the total *classified aggressor-side traded quantity within the time window*, not total bookmaker handle or resting order size. Price movement uses explicitly labeled last trade or midpoint, never silently switches series. Reserve enhanced trade-feed metadata for the expanded panel; default card must be scannable without clicking.

**Design:** bold dynamic team names/logos/colors appropriate to current sport card branding; clear movement colors, contrasting directional segments, no misleading green when price moves against our selected outcome; responsive mobile/desktop layouts; accessible charts and reduced-motion behavior; no fake charts, static dummy 'sharp money', or invented logos/quotes.

## PHASE E — SIGNAL PROSPECTIVE VALIDATION AND MARKET OPPORTUNITY LEARNING

- Baselines: no-signal, market-alone, Pinnacle-alone where market matched, current independent champion; compare to flow-enhanced SHADOW challengers without contaminating champions.
- Label outcomes: subsequent market-price moves at fixed windows, closing price where available, event outcome, fill-simulated net profit after fees, risk/drawdown, and realized ticket results only for confirmed executions.
- Require time-split/walk-forward plus forward prospective evaluation, stable evaluation timestamps, statistical uncertainty and adequate sample sufficiency. Evaluate subsets by sport/league, market type, price bands, liquidity, pregame/live, signal horizon, event-state regime, sample quality and venue.
- Use proper loss measures, calibration, PR/ROC for direction signals where appropriate, precision of extreme flags, realistic CLV and fill-adjusted economics. An unfilled observed quote never counts as profit.
- Mark hypothesized 'sharp' patterns as RESEARCH until forward results outperform meaningful benchmarks.
- Expose a readable Signal Research Report: which features helped, which failed, how many trade observations supported each, plus costs and missing-data bias.
- Do not change canQualify, wager-authorization, champion coefficients, or execution rights automatically.

## PHASE F — DELIVERY AND PROOF

Perform implementation in bounded PRs with compatibility checkpoints. Expected sequence:

1. Audit/fixtures, verified API contracts, current cost/coverage baseline, and typed parser tests.
2. Full public market-data/trade subscriptions plus read-only persistence, health and free-tier guards.
3. Flow aggregation + price movement + explainable observed signal calculations with deterministic replay.
4. UI components in current matchup cards and expanded market workspace, including state badges.
5. Potential-informed-flow SHADOW research, PinnOdds comparable-market analysis and validation pipeline.
6. Prospective economic reports and performance/cost review; further scaling only after proof.

**Mandatory acceptance tests:**
- Full and lite market messages, trade messages, state transitions, malformed frames, decimal quantities, directional intent mapping, and all supported market settlement types.
- Duplicate/replayed frames and maker+taker counterparty handling: exactly one observed trade per match.
- Disconnect/reconnect/dropped windows: confidence falls, gap documented, counts never silently inferred.
- Mathematical definitions: YES and NO prices, American odds both signs, percentage-point movement, USD versus shares, signed volume, bid/ask VWAP, fees, depth and spread; edge cases for empty/crossed books.
- Order-flow charts reflect persisted real data, NEVER fixture data in production.
- Server/client secrets isolation; authenticated market-only read, no order routes or trading actions.
- D1 read/write limits, R2 retention, bounded subscriptions, and $0 incremental cost feasibility.
- Full existing FBIS test suite and sport-specific regression tests; new API endpoints remain read-only; no new qualified wager state.
- Smoke test production-like deployment, verify actual counts before/after and report real deployment SHA.

**Definition of done:** existing Polymarket US markets produce traceable book and trade observations, correct probability movement and aggressive flow, honest potential-informed-flow research badges, usable fee/depth-aware market comparisons, and prospective signal metrics without new ongoing expense, model-authority changes, or trading permissions. Features blocked by a missing provider field or free-tier limit must be labeled blocked and reported, not fabricated.

## GOVERNANCE AND REPORT FORMAT

Follow docs/FBIS-MODEL-SYSTEM-STANDARD.md, docs/continuous-learning-governance.md, docs/polymarket-us-market-integration.md, the FBIS sport growth mandate, and the profit-first roadmap. Before and after every bounded build, document:

CURRENT VERIFIED STATE | COMPLETED | DATA CAPTURED | MARKET/TRADE COVERAGE | UI EVIDENCE | MODEL IMPACT | PROSPECTIVE ECONOMICS | FREE-TIER COST | SYSTEM HEALTH | GOVERNANCE/SAFETY | REMAINING BLOCKERS | NEXT HIGHEST-VALUE BUILD.

Do not claim the system is live or a signal profitable without matching production and prospective evidence. No autonomous bets and no paid expansion.

## REFERENCE DOCUMENTATION — RECHECK AT IMPLEMENTATION TIME

- Polymarket US market WebSocket: https://docs.polymarket.us/api-reference/websocket/markets
- Polymarket US private WebSocket (future separately authorized): https://docs.polymarket.us/api-reference/websocket/private
- Market book: https://docs.polymarket.us/api-reference/markets/get-market-book
- Sports identity fields: https://docs.polymarket.us/trader-guide/sports-schema
- Fee schedule with effective-date changes: https://docs.polymarket.us/fees
- Rate limits: https://docs.polymarket.us/api-reference/rate-limits
- Existing FBIS source/architecture: repository main and deployed health.

**Standing instruction for any future FBIS work:** market depth and trade flow are market microstructure evidence, not sportsbook ticket/money splits and not a license to infer specific traders' ability. Show market movement and flow prominently; earn financial authority through independent prospective proof.
