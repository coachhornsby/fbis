# Action/Apify Provider Championship Plan

## Purpose

PR #63 proved Action Network via Apify **works** as shadow market intelligence.

This plan answers a different question:

> Is Action/Apify quantitatively superior to FBIS’s current market-data providers and sufficiently reliable/economical to become the primary FBIS market-data source?

The incumbent production hierarchy is **not sacred**. If Action/Apify wins on evidence, FBIS should be willing to redesign around it in a **separate future promotion PR**.

This document is research planning only. It does **not**:

- promote Action/Apify into `ODDS_PROVIDER_ORDER`
- change CFB-FBIS-v2 coefficients or projection features
- flip `canQualify` / `canAuthorizeWager`
- invent bankroll-dollar sizing concepts (units only)

## Current production baseline (incumbent)

```
Parlay → TheOdds → SharpAPI → TheRundown → fail closed
```

Action/Apify remains:

- `ACTION_APIFY` shadow-only
- `decisionEligible=false`
- `canQualify=false`
- `canAuthorizeWager=false`
- never a CFB-FBIS-v2 projection feature

## Contenders

| Provider | Role today | Championship status |
| --- | --- | --- |
| Action Network via Apify | Shadow intelligence | Challenger |
| Parlay | Primary | Incumbent |
| TheOdds API | Backup | Incumbent |
| SharpAPI | Soft backup | Incumbent |
| TheRundown | Soft backup | Incumbent |

Where a provider lacks a market/capability, record **UNSUPPORTED** explicitly. Do not treat absence as zero-error agreement.

## Sports / markets in scope

### CFB
- Full-game spread, total, moneyline (where available)
- Opening / current / closing lines for completed games
- Per-book markets
- Line movement / history
- Public betting splits where available

### NFL
Same core as CFB, plus props where useful for provider capability scoring (not for projection features).

### MLB
- Full-game moneyline, run line, total
- First Five (`firstfiveinnings`)
- Opening / current / closing
- Multi-book
- Line movement
- Player props
- Public betting splits

## Comparison methodology

Comparisons must be:

1. **Same event**
2. **Same market**
3. **Same period**
4. **Same sportsbook when possible**
5. **Observation-time aware**

Do **not** call a price disagreement an error merely because two sources were collected at different timestamps.

Store and compare:

- `sourceObservedAt` (provider-supplied when present)
- `collectedAt` (FBIS scrape/request time)
- never invent historical `observedAt`
- never treat `scrapedAt` as `sourceObservedAt`

Use shadow tables from migration `0020_action_apify_shadow`:

- `shadow_provider_runs`
- `shadow_market_observations`
- `shadow_market_books`
- `shadow_market_splits`
- `shadow_line_movement`
- `shadow_provider_comparisons`

## Scorecard dimensions

### 1. Coverage
- games expected vs returned
- match rate to FBIS event identity
- supported markets / periods
- books per game
- props per game (where applicable)
- missing events / markets / books

### 2. Freshness / latency
- source observation timestamp
- collection timestamp
- lag vs independently observed sportsbook movement
- stale-market rate
- time until a known market change appears

### 3. Accuracy (matched book/market/period)
- exact spread agreement
- absolute spread difference
- exact total agreement
- absolute total difference
- moneyline absolute price difference
- best-price agreement
- open-line agreement
- close-line agreement

Prefer book-specific validation over consensus-only.

### 4. Historical quality
- completed-game coverage
- final scores
- opening / closing lines
- timestamped movement
- ATS / O-U grading when supplied
- historical availability by season
- reconstructability without temporal leakage

### 5. Market intelligence (Action unique value)
- ticket %
- money %
- money–ticket divergence
- bet count
- sharp-side indicators
- line movement / open→current relationship
- best price / book
- player / game props

These remain **downstream market intelligence** during research. Do **not** feed them into independent FBIS projection models in this phase.

### 6. Reliability
- successful / failed runs
- HTTP / malformed / empty payloads
- event-matching failures
- duplicate events
- unexpected schema changes
- stale observations
- runtime / retries required

### 7. Economics (actual cost, not list price)
For Action/Apify record:

- run-start charges
- scoreboard charges
- row charges
- movement charges
- props charges
- other optional blocks
- total cost/run
- cost/game
- cost/slate
- projected monthly cost

#### Monthly projection scenarios
Build projected monthly costs for MLB, NFL, CFB, and combined:

| Scenario | Description |
| --- | --- |
| A | One comprehensive collection per slate/game |
| B | Normal FBIS production cadence |
| C | Heavier pregame cadence |
| D | Base + line movement |
| E | Base + MLB F5 + movement |
| F | Targeted player props |
| G | Worst reasonable busy-season month |

Question to answer honestly:

> Can the **$19/month Apify Starter** cover actual MLB + NFL + CFB collection FBIS needs for a normal month?

Do **not** force yes. If projected cost is slightly above $19 but data is materially superior, report that rather than artificially reducing useful collection just to hit the ceiling.

## Sample / duration recommendation

Minimum evidence before a promotion recommendation:

1. **At least 14 calendar days** of shadow collection spanning weekdays + weekends
2. **At least one full CFB Saturday slate** and **one NFL Sunday slate**
3. **At least 5 MLB dates** including F5-enabled runs
4. **≥ 200 matched event-market-book triples** across incumbents vs Action
5. **≥ 50 completed games** with open/close comparison where available
6. Reliability log covering every scheduled shadow run (success/fail/cost)

No additional Apify spend is required merely to author this plan. Live championship collection **does** require a rotated Apify token in secret storage and will consume paid usage.

## Decision outcomes

Produce a comparative scorecard with raw metrics and one recommendation:

| Outcome | Meaning |
| --- | --- |
| **KEEP SHADOW** | Useful intelligence; inferior/unreliable as authoritative market source |
| **CO-PRIMARY / VALIDATION** | Excellent, but keep a direct provider for reliability/contract/timestamp reasons |
| **PRIMARY CANDIDATE** | Materially superior + economically sustainable → propose separate promotion PR |
| **REJECT** | Too unreliable, inaccurate, expensive, or operationally risky |

## Architecture principle if Action wins

Even if Action/Apify becomes primary, do **not** make it the sole source automatically.

Because it is an unofficial/community Actor dependent on Action Network endpoints, preserve at least one genuinely independent fallback.

Likely future shape **if evidence supports it** (not implemented here):

```
Action/Apify
    ↓
independent direct provider
    ↓
additional fallback if economically justified
    ↓
FAIL CLOSED
```

## Terms / operational risk (separate from technical score)

Keep technical capability distinct from contractual/commercial suitability:

- Action/Apify is an unofficial/community-maintained Actor
- Technical access ≠ redistribution/commercial rights
- Action Network terms/licensing must be evaluated before any customer-facing commercial rollout depends on scraped Action data

Do not block shadow research on this, but do not ignore it in a production recommendation.

## Security

Treat any Apify token previously pasted into chat as compromised.

Before persistent live championship runs:

1. Rotate/revoke the exposed token
2. Install the replacement only through approved secret storage
3. Never commit, log, print, put in workflow-dispatch inputs, artifacts, D1, or client JS

If a rotated token is unavailable, continue offline/fixture work and cost modeling from already-collected A–F artifacts; do not fabricate a token.

## FBIS non-negotiables (unchanged)

- Private repository; no history rewrite / force-push for cleanup
- Additive migrations only
- No fake probabilities / EV / fabricated markets
- No stale market silently treated as current
- No closing-line leakage into projections
- Units only (no bankroll dollars)
- Human confirmation before wager execution
- Infrastructure changes cannot grant model authority
- Projection ≠ qualification ≠ authorization ≠ execution
- CFB-FBIS-v2 remains isolated from Action market-intelligence features
- Fail closed when required market/provenance data is unavailable

## Implementation sequence (future work; not this PR)

1. Merge post-#62 cache-attribution fix (#64) so incumbent baselines are not self-poisoned during comparison
2. Owner rotates Apify token into secret storage
3. Add scheduled **shadow-only** championship collector writing to `shadow_*` tables
4. Add offline scorecard builder over stored comparisons (no router changes)
5. Run 14-day sample across CFB/NFL/MLB
6. Publish scorecard + recommendation
7. Only if PRIMARY CANDIDATE: open a **separate** promotion design PR (still with independent fallback)

## What #63 already gives us

- Free-plan-safe Actor adapter + enum aliases
- Shadow schema (`0020_action_apify_shadow`)
- Normalization / matching / comparison scaffolding
- Offline fixtures + tests
- Live A–F capability evidence (~$0.79)
- Documented KEEP/SHADOW/DEFER recommendation for the discovery phase

## Remaining before championship collection

- Rotated Apify secret
- Scheduled shadow collector + cost ledger
- Scorecard aggregation job
- Explicit unsupported-capability matrix per provider
- Optional: independent book-observation spot checks for accuracy calibration

## Paid Apify usage

- **Not required** to finalize this plan document
- **Required** for the live championship sample
- Discovery A–F already spent ~$0.79 under the $1 research budget; championship cadence will need Starter or careful free-plan throttling with honest coverage limits
