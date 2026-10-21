# FBIS — Profit-First, Free-First Operating Mandate and Development Roadmap

**Version:** 1.0 — Proposed for CEO adoption  
**Date:** October 14, 2026  
**Scope:** All FBIS sports, markets, projections, data pipelines, trading research, and shared infrastructure  
**Authority:** Business and engineering prioritization only. This document does not grant model, wager, order-placement, or deployment authority.

## 1. North star

Build FBIS to **maximize sustainable, risk-controlled, after-cost net profit from legally accessible sports betting and probability markets**.

The objective is **dollars earned at acceptable risk**, not the number of predictions, volume of bets, screen refresh rate, raw model accuracy, or number of feeds connected. Betting profits are not guaranteed; a claimed edge is a hypothesis until prospective evidence supports it.

The FBIS economic loop is:

**OBSERVE -> FREEZE POINT-IN-TIME STATE -> PRICE INDEPENDENTLY -> COMPARE EXECUTABLE MARKETS -> FILTER BY UNCERTAINTY, LIQUIDITY, AND COST -> QUALIFY -> OPERATOR DECISION -> RECORD -> SETTLE -> GRADE -> LEARN.**

Research is encouraged. Automatic promotion and automatic wagering authority remain prohibited under existing governance.

## 2. The architectural compromise: hybrid, not high-frequency everywhere

**Keep batch collection for slow-moving information. Make important changes reactive. Run selective in-game state pricing only when a trustworthy source and validated model exist.**

- **Nightly/periodic:** canonical historical ingest, team/player ratings, retraining candidates, feature generation, reconciliation, grading, and drift reports.
- **Event-triggered pregame:** approved lineup/starting-player confirmation, material injury change, weather change, verified roster/status correction, and market movement research. Recalculate the affected game only. A market movement must not alter the independent projection; market-informed challengers belong in a separately labeled research lane.
- **Selective live:** verified play-by-play and live game-state changes update a separately versioned in-play model for a small research universe; do not poll every game at maximum frequency.
- **Market streaming:** retain the existing Polymarket US read-only bounded sampler/stream service; measure coverage, heartbeat, source timestamps, BBO, depth when supported, and quote age before increasing subscriptions.
- **Presentation:** preserve existing sport pages and approved matchup cards. Add a common cross-sport opportunity ribbon/workspace; do not replace all UI with an unrelated trading terminal.
- **Storage:** retain D1 for canonical evidence and R2 for durable archive; store immutable decision/event snapshots, not every unchanged second of every game.

**Do not assume Polars, TimescaleDB, Redis, FastAPI, Next.js, or DigitalOcean are necessary or currently the main production stack.** Add new infrastructure only after benchmarked limits justify it.

## 3. Spending policy

**Default incremental recurring spend authority: $0/month.** This means no new subscription, upgraded plan, server, premium data feed, metered paid pull, or order-management service without explicit CEO approval.

1. Reuse existing prepaid subscriptions and approved API quotas only within their existing budgets and terms.
2. Inventory and report **total actual FBIS run-rate**, separating current fixed costs, metered usage, new commitments, and one-time development costs. Do not mistake "$0 incremental" for "$0 total."
3. Apply request budgets, caching, deduplication, bounded sampling, backoff, query optimization, and circuit breakers before requesting a paid upgrade.
4. Set operational warnings at 70% of relevant free-tier limits and automatically downshift nonessential research capture before a known hard limit is exhausted. Preserve essential health, canonical evidence, and settlement pipelines where feasible.
5. Do not pay for access to a feed without reviewing its terms and actual availability, latency, and coverage. No unauthorized scraping or attempts to circumvent provider rate limits.
6. Do not silently launch premium provider jobs as fallbacks for experimental research.
7. **Profit-funded upgrade test (policy proposal):** after at least three consecutive positive months of verified *net realized betting P&L*, the CEO may approve a new recurring cost only if (a) trailing three-month average monthly net profit is at least **3x** that proposed cost, (b) a bounded trial or clear evidence supports its incremental economic contribution, (c) downside/bankroll needs are covered, and (d) the CEO explicitly approves. This is a review gate, not automatic permission. Exceptions require explicit approval.

Cash contributed to bankroll, unrealized value, paper-test returns, ungraded picks, and deposits are not operating profits. Track taxes separately, and report the cost of data and infrastructure alongside settled betting results.

## 4. Nonnegotiable model and risk rules

The canonical **docs/FBIS-MODEL-SYSTEM-STANDARD.md**, continuous-learning governance, sport manuals, and current FMIS/operator risk rules remain controlling. This roadmap does not modify them.

- Preserve independent, market-blind pregame champions and their versions. Never force prices or late market data into those priors.
- Segregate market-aware models, contextual challengers, and online learning into labeled research/shadow lanes.
- Maintain source event times, capture times, ingestion times, projection times, market times, model versions, game/market identity, and immutable decision snapshots.
- Differentiate **indicated price**, **best executable quote**, **realistic fill after fees/slippage**, and **confirmed execution**. Unknown liquidity or market access is not a verified bet.
- New or materially changed live models begin **SHADOW / canQualify=false / canAuthorizeWager=false**. They may gain authority only through sport/market-specific prospective validation and explicit CEO approval.
- No chase, no forced bets, no automatic order placement, no implicit model promotions, and no automatic increase in bankroll exposure. Existing configurable limits take precedence. Fractional Kelly is a sizing research input, not a license to overbet uncertain probabilities.
- A failed or stale source must show a clear **STALE / INCOMPLETE / UNPRICED / RESEARCH / PASS** state and must not turn a game into a qualified recommendation.

## 5. How FBIS should rank opportunities

Research rank should estimate **realistically attainable risk-adjusted net profit**, rather than ranking only by absolute probability difference.

For a candidate, capture:
- Independent calibrated probability and uncertainty; versioned market-specific model role.
- Contract terms, exact side/line/period/settlement rules, legal venue access, and market identity match.
- Fresh executable bid/ask, available size at that price, quote age, liquidity, fees, slippage, and fill likelihood.
- Net expected return per dollar, estimated net dollars at an allowable stake, and edge confidence.
- Bankroll usage, existing correlated exposure, drawdown consequences, and operator limits.

**Expected opportunity contribution (research metric)** ~= credible fill probability x permitted capital at realistic fill price x estimated net ROI, net of attributable costs. This metric is not a wagering authority gate unless separately validated.

A 5% apparent edge on a nonexecutable or thin quote does not outrank a smaller, repeatable edge with verified fill capacity. Arbitrage and cross-market links require equivalent settlement definitions and executable prices; apparent price mismatches do not by themselves create risk-free profit.

## 6. Bounded roadmap (sequence, not deadline or commitment to new spend)

| Stage | Build | Deliverable | Exit test |
| --- | --- | --- | --- |
| **0 — Truth and cost audit** | Confirm actual live repo/deployment SHA; D1/Worker/DO health, data latency, provider entitlements, cost baseline, quota headroom, sport/model authorities. | Cost/coverage/latency dashboard, prioritized bottlenecks, zero-new-cost plan. | Current source/production state verified, gaps explicitly logged. |
| **1 — Reactive pregame** | Lightweight change detection, game-specific recompute, model versioning, immutable projection snapshot, freshness indicators, reason codes. | Live-updating pregame fair values from verified non-market inputs. | No future leakage; independent champion unchanged; deterministic tests and historical replay. |
| **2 — Market intelligence** | Complete bounded Polymarket US market/quote monitoring, strengthen matching/BBO/depth/staleness, record prospective market opportunities and misses. | Read-only executable-price *research* screener with missing-data gates. | Coverage and real-world quote persistence measured; no unauthorized bets. |
| **3 — One live sport** | Choose one sport/market only after source quality and independent pregame priors pass; integrate event-state updates and a shadow in-play probability model. | Live state timeline, model vs. market, state/quote event times, forward shadow grading. | Proven chronology, calibration and comparable paired prospective evidence; stays SHADOW unless separately approved. |
| **4 — Unified opportunity workspace** | Add cross-sport ranked ribbon and one-game research detail without replacing existing cards. | Clear context, odds, net EV research, latency, liquidity, exposure, and alerts. | No degraded core UX, no mislabeled observed quote, no new monthly spending. |
| **5 — Qualified manual workflow** | For specific sport/market cohorts only, evaluate prospective CLV, simulated fill realism, net economics, and risk; request existing governance authorization where deserved. | Operator-reviewed bet candidates and executed-slip reconciliation. | Independently supported qualification; operator remains in control. |
| **6 — Optional execution engineering** | Only after demand and profitability justify it: paper order lifecycle, cancel/replace/partial-fill tests, kill switches, accounting and compliance review. | Separate proposal for execution-assist or automation. | Never live automatically; requires new explicit CEO authorization. |

**Pilot selection rule:** prefer the sport and market that offer (1) a healthy independent pregame model, (2) reliable, legally usable live events, (3) accessible tradable markets, (4) enough prospective observations, and (5) a credible economic gap. Do not select tennis, NBA, MLB, or football simply because one looks exciting.

## 7. Weekly management scoreboard

Report by sport, market family, model, venue, and pregame/live cohort:

**Economic:** settled net betting P&L, ROI on risked capital, opportunity count, price availability, fees/slippage, actual fill rate, CLV where the required close exists, peak drawdown, and bankroll exposure.

**Predictive:** Brier/log loss, calibration, baseline comparison, event-level errors, uncertainty coverage, prospective sample size, and model drift.

**Operational:** percentage of scheduled games covered, event-to-source delay, source-to-projection delay, projection/quote age, missing data, stream uptime, rejected identities, failed jobs, settlement completeness, daily free-quota usage, and monthly all-in operating cost.

**Governance:** model statuses, challenger outcomes, pending approvals, blocked gates, temporal violations, and rollback readiness.

Preserve missing metrics as **UNKNOWN/NULL**, never invented zeroes. Clearly separate realized betting profits from hypothetical model returns.

## 8. Immediate priority order

1. Verify current production state and existing recurring/metered expenses; fix broken acquisition, matching, settlement, and health before adding more feeds.
2. Finish making existing pregame models **current, complete, credible, and prospectively graded**.
3. Add game-specific reactive triggers from trusted, available source events.
4. Validate the existing read-only Polymarket US stream and executable-price observations.
5. Select **one** live-model challenger for forward shadow testing; expand across sports only after evidence justifies it.
6. Build the opportunity terminal from proven data, not fabricated fast-twitch projections.
7. Consider premium feeds or execution only under Section 3's explicit profit-funded approval process.

## 9. Market Money Flow Intelligence — approved roadmap candidate

The dedicated implementation specification is **docs/FBIS-POLYMARKET-US-MARKET-FLOW-INTELLIGENCE-BUILD.md**.

Add **Market Probability Movement**, **Observed Flow Signal**, **Flow Analysis**, fee/depth-aware Polymarket US quotes, and **Potential Informed Flow — Unverified** to the bounded market-intelligence and matchup-card research roadmap. Prioritize usable, readable cards and transparent underlying evidence.

- Retain actual trade aggressor direction, bids/asks and depth, validated cumulative-volume changes, market-state timing and gap metrics. Build confidence only from verified units and coverage.
- Market probability movement must distinguish last trade, midpoint, bid, ask, executable prices and independent FBIS fair value.
- Aggressive-buy/sell flow is **not** sportsbook ticket percentage, total net money entering an exchange or a verified count of sharp bettors. Do not label inferred activity as confirmed sharp money.
- Show price-leading patterns and cross-venue agreement as research hypotheses; validate prospectively against outcomes, later market movement, fill-adjusted net economics and independent model baselines.
- Preserve $0 incremental monthly spending, read-only provider roles, market-blind champions and operator authorization.

**Status:** proposed engineering scope only; no implementation, model-qualification change, or live trading authorization is implied.

## 10. Source-of-truth and adoption

- Code, schemas, risk rules, model standards, and this charter live in Git.
- Live operational truth lives in Cloudflare/D1, not in an outdated README or spreadsheet mirror.
- The FBIS Individual Sport Platform Alignment & Growth Mandate continues to govern each specialized sport.
- A proposal, PR, passing CI, or fresh dashboard does **not** establish a deployed feature, production health, profit, or betting authority.
- **Adoption:** CEO approves the policy and future engineering tasks separately. This document itself changes no production code, models, risk caps, or execution permissions.

### External free-tier references (check again before budgeting)

- Cloudflare Workers and Pages Functions: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare D1: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/platform/pricing/
- GitHub Actions public repository runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- Polymarket US API: https://docs.polymarket.us/api-reference/introduction

**Strategic test for every feature:** *Does this reliably increase attainable expected net profit or reduce material risk at a cost we can justify, while preserving independent evidence and operator control?*
