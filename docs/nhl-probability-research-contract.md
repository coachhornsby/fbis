# NHL research probability and settlement contract

## Scope and review decision

This patch is an isolated, pure settlement kernel, not a fitted NHL challenger,
qualification grant, live endpoint, or production model replacement. It accepts
a supplied joint regulation score law and separately supplied OT/SO winner law.
It does not turn expected-goal differences into probabilities. No live code
imports it. No acquisition, database, model registry, or settlement writer changes.

The incumbent's final-score versus regulation target ambiguity blocks adapting
its means automatically. Independent review must resolve the target and empirical
fit before a fitted challenger is added. Supplying the required provenance fields
does not independently verify their truth or the immutability of an artifact.

## Incumbent consumer and feature boundaries

`slateEngine.js` loads official NHL context, attaches NHL-FBIS-v1 and NHL-PRO-v2,
attaches the goalie shadow, promotes the research-board projection, and attaches
player research. `todayBoard.js` serializes these paths. `nhlWagerV1.js` independently
recomputes spread/total probabilities from expected goals and builds offers.
`nhl-wager-research.js` persists research decisions; it is not a read-only endpoint.
`proPlayerProjectionLayer.js` and `nhlPlayerProV2.js` consume team goals and goalie
context. `matchupFactors.js` and `CompactGameCard.jsx` present the board.

| Evidence | Live NHL-PRO-v2 behavior | Walk-forward behavior / limitation |
| --- | --- | --- |
| Goals for/against | `nhlFbisV1.blendSummary` blends prior/current with games/25; `projectNhlProV2Game` blends again with games/24 | One games/24 blend; live current-season influence is attenuated twice |
| xG, shot pressure, special teams xG | `baseTeamRate` reads the fitted artifact | `forecastV2` blends rolling current-season event-chain state |
| Personnel | Weighted skater historical finishing factors; optional scratch/opportunity adjustment | Rolling participation; different finishing factor and goalie mixture |
| Goalie | Highest-start goalie, current then prior; missing candidate/prior produces zero | Prior-trained talent with recent goalie usage; no game-specific confirmation guarantee |
| Situation | Home advantage +0.12; rest-day-minus-one convention; capped rest difference | Home advantage/rest; no persisted travel-state term in live projection |
| Tracking/opportunity | Optional EDGE and scratch adjustments actually added to goals | Not equivalent to the live overlays; advisory labeling is not proof of no effect |
| Persistent team/goalie/travel profiles | Loaded and returned; `appliedToProjection:false` | Separate challenger, not incumbent evidence |

The artifact preserves team differences. Compression alone is not proof that
team strength is absent or that means should be spread farther apart. The clamp
1.45–5.25 does not itself explain values around 3.0–3.7. No weights are changed here.

`nhlProV2.bivariateDistribution` uses a shared Poisson component with fixed rule
min(0.32, 0.10*min(mean)), truncates support, and renormalizes. It invents an OT
head from logistic(goal difference / 0.65); totals and puck-line calculations use
the unresolved regulation grid. Afterwards moneyline alone is recalibrated with
Elo/shrinkage. These heads do not derive from one final-score law.

`nhlWagerV1.nhlMarketDistribution` exposes cover/over/under conditional on no push,
plus unconditional push probabilities. They cannot be added as if unconditional.
Its odds fallback includes `fairHomeMl`/`fairAwayMl`; provenance of those fallback
fields must be reviewed separately before any executable edge claim.

Both fit and walk-forward scripts read schedule final scores. Period separation
and regulation-only means are not established by those targets. An existing
`pointInTime:true` flag is not an immutable pregame forecast capture.

Internal NHL-PRO-v2 and NHL-WAGER-v1 qualification flags differ from the research
board/registry's flags. Existing wager authority stays false. This patch does not
resolve or alter the existing distinction; every new output is unvalidated.

## Kernel contract

Export: `buildNhlResearchMarkets` in `functions/lib/nhlProbabilityResearch.js`.

Inputs:

- `regulation.scoreBasis` must equal `REGULATION`.
- `regulation.cells`: unique `(home, away, probability)` cells with nonnegative
  integer scores 0–64 and a total mass within 1e-10 of one. At most 4,096 cells.
  This is a computational support bound, not a fitted tail cutoff. Truncated laws
  must not claim completeness. The kernel never silently renormalizes a tail.
- Provenance: event ID, ordered home/away team IDs, model ID/version, artifact
  SHA-256, trained/feature-cutoff/snapshot/start times as integer UTC milliseconds.
  Training and features cannot follow the snapshot; snapshot must precede start.
- Optional `overtime.scoreBasis`: `NHL_FINAL_ONE_DECIDING_GOAL`. Every positive-mass
  tied score requires its own supplied home-win probability. No default, equal
  split, or goal-difference formula. OT provenance must match event, ordered teams,
  and start. It can use a different, independently fitted model.
- Explicit requested half/integer lines only. No bookmaker names or prices are
  generated. Up to 128 requests; supported families TOTAL, TEAM_TOTAL, PUCK_LINE.
- Optional independently sourced FIRST_PERIOD joint law and period line requests.
  No whole-game thinning or one-third conversion.

For a tied regulation cell `(k,k)`, the supported final-score contract places its
mass into `(k+1,k)` and `(k,k+1)` using the supplied tie-resolution probabilities.
The exact same resulting law prices full-game ML, puck lines, totals, and team
totals. Untied cells do not change. Regulation 3-way uses the original law.

Pinnacle's hockey rules include OT/SO by default and credit one goal to a shootout
winner: <https://www.pinnacle.com/en/future/betting-rules>, Hockey rules 1–2.
This documents the supported contract, not universal book/market equivalence.
Void, suspension, abandonment, player statistics, and differently specified markets
are outside this kernel. A future adapter must validate the actual bet's contract.

Outputs carry unconditional win/lose/push, a separately named conditional probability,
fair decimal/American odds, research status, and no verified edge. Fair decimal odds
are `(win+lose)/win`, reflecting refunded pushes. All-push or impossible outcomes
have unavailable/degenerate odds. No sentinel zero replaces unavailable comparisons.

Uncertainty is explicitly UNVALIDATED with null estimation interval. Normalized
mass is checked; empirical fit, original truncation, calibration, and parameter
uncertainty cannot be inferred from a normalized supplied PMF. No fitted distribution
family or coefficient is selected in this patch. Arbitrary joint laws allow empirical
dependence/variance alternatives once independently fitted and reviewed.

Missing OT inputs leave full-game outputs unavailable while preserving regulation.
Missing period inputs leave period outputs unavailable. Missing model/provenance,
target mismatch, non-normalized support, or invalid identities throw explicit errors.
These errors are local contract failures; no fallback invokes a live provider.

## Board presentation contract (design only)

| Priority | Display | Required state |
| --- | --- | --- |
| 1 | Home/away full-game win percentage and fair ML | Settlement contract, model/version, frozen snapshot; MODEL_ONLY until independently validated |
| 2 | Expected goals | Explicit REGULATION or FINAL label; do not label decimal means as literal predicted final scores |
| 3 | Puck line / totals | Requested or observed line; unconditional win/lose/push and push-aware fair odds |
| 4 | Regulation 3-way | Home/draw/away reconciliation and regulation-only label |
| 5 | Team / first-period markets | Own supported inputs and independent market-family validation status |
| 6 | Inputs and authority | Source observation/acquisition times separately, age, goalie ID/status, model authority |

States: VERIFIED_MARKET_EDGE, MODEL_ONLY, RESEARCH_SHADOW, INPUTS_MISSING,
INPUTS_STALE, MARKET_BLOCKED. A verified market edge requires independently qualified
family, current executable two-sided market, observed price provenance, settlement
compatibility, and existing governance approval. This kernel grants none of them.
Do not render BEST EDGE +0 for no market. Do not render unknown goalies as EVEN 0.
Show “starter unconfirmed” or “goalie input unavailable”; preserve real zero separately.
Existing presentation follow-up PR #921 is independently reviewable; this patch
does not incorporate it or change the board.

## Validation and shortest safe continuation

1. Review this settlement contract and existing mean-target ambiguity independently.
2. Build a local PIT dataset with regulation, OT/SO, period outcomes and raw checksums;
   frozen features/predictions and artifact training cutoffs must precede each event.
   Match ordered teams, season, game type, provider IDs, and ARI/UTA lineage explicitly.
3. Reconcile live versus walk-forward feature definitions before comparing incumbents.
   Do not retune coefficients to conceal serving differences.
4. Fit independent Poisson, bivariate/dependent, and overdispersion alternatives on
   training folds only; select on disjoint validation folds and report final untouched
   test results. Fit tie-resolution separately; include score dependence if supported.
5. Score each market family separately: multiclass regulation log loss/Brier,
   full-game ML log loss/Brier, score PMF likelihood, calibration, and win/lose/push
   markets. Use real observed lines for market tests and executable historical prices
   for economics. No synthetic prices, closing quotes after freeze, or postgame features.
6. Run prospective research with immutable captures under separate authorization.
   Independently qualify each market; no automatic board promotion or wager authority.
7. Add the board contract only after input validity and market-family evidence pass.

Review checklist: one final-law reconciliation; push handling; target/provenance and
ordered team checks; no means adapter; no fabricated lines/prices; explicit unvalidated
uncertainty; bounded input sizes; no production imports; registry/accounting/policy
diff absent. Rollback for a future approved merge is a code revert only; no schema/data
migration exists. Merge/deploy and qualification all require separate authorization.

## Numeric quote domain

Accepted score-law probabilities are never clamped to manufacture finite odds. If either decimal or American odds overflows the finite JavaScript Number domain, both odds fields are null and fairOddsStatus is NUMERIC_DOMAIN_UNAVAILABLE. Win/lose/push probabilities and research authority remain unchanged. ALL_PUSH and DEGENERATE keep their existing semantics.
