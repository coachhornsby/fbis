# NHL full-game moneyline integrity and three-head research — 2026-10-10

## Scope and baseline

- Repository: `coachhornsby/fbis`
- Inspected `main`: `61ecb6effaedb40f0861f8ec87ca97718c8a644e`.
- This branch implements future-only integrity metadata and SHADOW-only research integration. It does **not** modify stored historical probabilities, qualifying model weights, settlements, staking, or the production model registry.
- No migrations, paid providers, merges, deployments or champion promotion.

## 1. Source path and observed defect

Active chain:
`slateEngine.buildSlate` ->
`attachNhlV1` ->
`attachNhlProV2` ->
`attachNhlGoalieProbabilityShadow` ->
`attachNhlUnifiedMoneylineShadow` (new) ->
`promoteNhlResearchToBoard` ->
`todayBoard` ->
`evaluateNhlGameWagers`.

Before repair:
1. `nhlProV2.js` computes a bivariate-Poisson home win including OT, then replaces the moneyline head with `clip(0.5+0.86*(0.78*scoreOnly+0.22*elo-0.5),0.04,0.96)`. It keeps the source heads under `rawHomeWinIncludingOt` and `eloHead`.
2. `nhlWinV1.js` independently produces a directional `classifierScore`, a thresholded winner pick and `calibratedHomeWinProbability` copied from PRO-v2. The classifier score is not demonstrated to be a calibrated probability.
3. `nhlGoalieProbabilityShadow.js` computes another full-game probability from attenuated goalie influence, preserving the PRO-v2 scoring projection and staying `SHADOW`.
4. `nhlProV2.js` selected goalies by highest historical starts, even when a timestamp-valid confirmed starter exists in persistent profiles.
5. `nhlWagerV1.js` could silently fall back to a separately recomputed distribution on missing probability, apply another unvalidated reliability shrinkage, and label positive provisional EV as `BET`/`canQualify` even when its confidence calibration was unvalidated. It also estimated full-game spreads/totals from a regulation-period distribution without explicit OT settlement adjustment.
6. `todayBoard.js` could infer `bettingAllowed` from `nhlProV2.canQualify` rather than the actual wager qualification path; `promoteNhlResearchToBoard` correctly sets `qualificationBlocked` and clears the generic `pHomeFinal`.
7. **Confirmed root cause, production D1 read-only:** `projLedger.freezeFromGame` previously computed `model.pHomeFinal ?? blendWinProb(model.layers,weights)`. NHL research promotion correctly cleared `model.pHomeFinal`, but the nullish fallback *reintroduced the generic market/form probability* while persisting PRO-v2 goal means and labeling the row `NHL-PRO-v2`. `slateEngineCore.projectGame` builds these generic heads independently of PRO-v2: `layers.market` from vig-free sportsbook/ESPN spread odds, `layers.score` from `logistic(projMargin,cfg.k)`, and `layers.form` from records. The tracker therefore displayed a hybrid score/probability pair. New freeze contract requires event-, team-, cutoff- and score-aligned PRO-v2 probability, or stores null and a fail-closed reason. Existing immutable records are untouched.

### October 10 discrepancy diagnostics

These are **not** immutable tracker reproductions. The four submitted rounded projected scores, run through the PRO-v2 bivariate-Poisson/OT mathematical definition, give:

| Home team | Reported mean home/away | Score-only P(home) | Tracker home P | Maximal final formula interval* |
|---|---|---:|---:|---:|
| Buffalo vs Utah | 3.3 / 3.2 | 0.5226 | 0.304 | [0.4054,0.6248] |
| Calgary vs Anaheim | 3.3 / 3.1 | 0.5453 | 0.245 | [0.4207,0.6400] |
| St. Louis vs Columbus | 3.2 / 3.1 | 0.5229 | 0.669 | [0.4054,0.6252] |
| Florida vs Minnesota | 3.4 / 3.1 | 0.5671 | 0.703 | [0.4356,0.6542] |

*Conservative interval: each displayed team goal mean allowed ±0.05 (one-decimal rounding), and Elo probability allowed the entire [0,1] range before the PRO-v2 78/22 blend and outer shrinkage. Numerical integration uses the same 0–11 team-specific Poisson counts and 0–5 shared component. All four tracker percentages are outside these intervals: the reported pairs are not the output of the PRO-v2 blended probability formula applied to those projected scores.*

**Read-only production D1 verification, October 10**: `prediction_snapshots` contained 46 NHL checkpoint rows for this date (query had zero database changes and zero rows written). The relevant frozen records are:

| Event ID | Matchup | Checkpoint | proj home / away | p_home_final | p_score | p_market | p_form |
|---|---|---|---|---|---|---|---|
| 401892472 | Utah @ Buffalo | MORNING | 3.3 / 3.2 | 0.3037462329 | 0.2814056074 | 0.2814056074 | 0.4545454545 |
| 401892480 | Anaheim @ Calgary | MORNING | 3.3 / 3.1 | 0.2450952065 | 0.2814056074 | 0.2814056074 | 0 |
| 401892477 | Columbus @ St. Louis | MORNING | 3.2 / 3.1 | 0.6688832882 | 0.7185943926 | 0.7185943926 | 0.3333333333 |
| 401891805 | Minnesota @ Florida | PREGAME | 3.4 / 3.1 | 0.7032918903 | 0.7185943926 | 0.7185943926 | 0.6 |

All four rows carry `engine=NHL-PRO-v2`, `model_version=research-v2.0-event-chain-gbdt`, `projection_kind=FBIS`; this labeled the generic probability blend as PRO-v2. The same 0.2814056/0.7185944 values occur in other different-goal games. A separate grouped production D1 audit found **32 of 32** October 10 snapshots labeled `NHL-PRO-v2` had `p_score=p_market` while their `p_home_final` was populated. Fourteen additional NHL snapshots in that date cohort were explicitly labeled `Pinnacle line-implied`, not misidentified as PRO-v2. This independently establishes a head-lineage error; **it is not a proof that the actual PRO-v2 win probability was incorrect**. Historical market/form probabilities must never be relabeled as pure PRO-v2 probabilities. D1 data and frozen outputs were not rewritten.

**Independent archive corroboration:** Read-only query of `nhl_goalie_probability_shadow` found immutable pregame incumbent NHL-PRO-v2 `homeWinIncludingOt` for three of these same event IDs, each with `temporal_integrity_passed=1`, cutoff `2026-10-10T17:52:59.743Z` and code SHA `d5d8499050c7ac0ce607d709baa234c4809678ec`. This archive is a separate goalie SHADOW cohort; do not treat its probabilities as scores from the same exact tracker freezing instant unless timestamps agree.

| Event ID | Tracker p_home_final | Archived PRO-v2 incumbent home probability | Archived PRO-v2 projected home / away | Delta (PRO minus tracker) |
|---|---:|---:|---|---:|
| 401892472 Buffalo | 0.3037462329 | 0.5494 | 3.31 / 3.19 | +0.24565 |
| 401892477 St. Louis | 0.6688832882 | 0.5203 | 3.19 / 3.14 | -0.14858 |
| 401891805 Florida | 0.7032918903 | 0.5305 | 3.39 / 3.12 | -0.17279 |
| 401892480 Calgary | 0.2450952065 | Unavailable in this goalie cohort | 3.3 / 3.1 in tracker | Unknown |

The tracker snapshots and goalie archive have different frozen timestamps; these differences are *model-head provenance comparisons*, not proof of simultaneous exact same-feature outputs. No writes were executed (`rows_written=0`, `changes=0`).

## 2. Changes

- `projLedger.js`: research-freeze writer now takes valid `NHL-PRO-v2` event-aligned full-game probability only if source identity/cutoff and goal-mean matching checks pass; it never falls back to `blendWinProb` for NHL. Independently archives generic `p_market` for context while setting `p_score` to the true raw PRO-v2 goal-distribution head. Adds source/cutoff/market-separation metadata to `layers_json`. For an incompatible or missing head, `p_home_final` and `p_score` are null with `nhl_probability_lineage_invalid_fail_closed`, **without changing historical rows or other sports**.
- `snapshotLearning.js`: historical legacy NHL tracker probabilities without the exact model/source/event/version/cutoff contract are filtered from probability/Brier/log-loss training, but their existing frozen values remain preserved and their independent projected goals remain eligible for margin/total grading. The earlier 30-graded-game NHL-PRO-v2 tracker Brier ~0.2263 must **not** be treated as independently verified PRO-v2 probability quality unless its contributing records meet this new lineage gate.
- `nhlUnifiedMoneylineShadow.js`: validates canonical event/team identity, feature cutoff prior to start, positive scoring means, regulation distribution mass, complementary full-game probabilities, unmodified projection, and component alignment. Publishes explicit PRO-v2, WIN-v1 and goalie shadow inputs. No combined probability is supplied without an independently validated fitted calibration artifact. Even an accepted fitted artifact returns research-only outputs with no authorization.
- `nhlProV2.js`: stamps event ID, game start and feature-cutoff timestamp. A goalie explicitly marked `CONFIRMED_STARTER`, with source-observed timestamp before both feature cutoff and game start, supersedes the highest-start-count proxy. Missing, late, or unverified evidence retains the pre-existing historical proxy, now explicitly labeled as such. A read-only audit of production `nhl_goalie_profiles` found **0 `CONFIRMED_STARTER` rows**: 32 `LAST_CONFIRMED_STARTER`, 30 `DEPTH`, and 12 `EXPECTED_G1`. `LAST_CONFIRMED_STARTER` describes the prior appearance, not confirmation of the upcoming game; it is intentionally not promoted to a current confirmed starter.
- `nhlGoalieProbabilityShadow.js`: adds confirmed/projected/proxy status, source timestamp and lineup alignment; removes wall-clock-dependent `featureCutoffTimestamp` from the pure projection result.
- `slateEngine.js`, `todayBoard.js`: wire the three-head shadow into research response, without setting generic `pHomeFinal` or changing champion authority. Board eligibility follows wager qualification and cannot be bypassed merely by an attached NHL-PRO-v2 research object.
- `nhlWagerV1.js`: remove silent moneyline fallback when its stored probability is missing/invalid; validate source identity and complementary heads; require a fresh (at most five minutes old), explicitly execution-verified and execution-available, matched same-book two-way quote plus verified full-game OT/shootout settlement scope; require calibrated probability lineage and valid goalie evidence before qualification. Regulation-derived spread and total research rows can no longer qualify without OT-aware settlement handling. Moneyline pricing now preserves the exact PRO-v2 probability without applying the unsupported secondary reliability shrink. Legacy research probability/EV columns remain *research only* and are explicitly marked unvalidated.
- `nhl-goalie-shadow.js`: store the three-head diagnostic vector, lineage and any research candidate inside the existing immutable `temporal_integrity_json` of future goalie shadow records, without a migration. This is an adjunct to existing goalie shadow evidence, **not** a separately qualified or exhaustively collected unified probability cohort.
- `nhlUnifiedMoneylineResearch.js`, `nhl-unified-moneyline-walkforward.mjs`: implement a PIT-fail-closed offline candidate set (incumbent, score only, calibrated incumbent, independent WIN, goalie only, each two-head combination, all three) using regularized logistic stacking, chronological train/validation/untouched-test seasons, paired Brier bootstrap, log loss, accuracy, ECE and diagnostic calibration fit, season and goalie-state splits. Refuse unsafe or insufficient historical inputs. The output is `UNQUALIFIED_SHADOW_RESEARCH` regardless of apparent success.

## 3. Measured existing historical evidence (not a new unified-model result)

**NHL-WIN-v1 validation artifact:** `data/models/nhl-win-v1-validation.json` reports 1,312 games in its 2025–26 test season. Incumbent Brier 0.24567/log loss 0.68425; logistic head Brier 0.25096/log loss 0.69582; calibrated logistic Brier 0.25353/log loss 0.70212. Its directional accuracy improvements do not justify substituting its uncalibrated score for moneyline probability.

**Goalie historical expansion:** `data/models/nhl-goalie-prob-historical-expansion-v1.json` reports 4,574 usable 2019–23 games. Incumbent Brier 0.233971/log loss 0.660366/ECE 0.028226; goalie shadow Brier 0.234220/log loss 0.660886/ECE 0.035699. Paired Brier delta +0.00024931, reported 95% interval [-0.00023725,+0.00075949]. Additional historical goalie probability is not established as an improvement.

**No validated three-head joint PIT dataset** was available for this branch. The point-in-time model versions overlap imperfectly, and reconstructing old feature snapshots from postgame aggregates would contaminate the test. No three-head weights, numerical combined probability, OOS superiority, or market edge are claimed.

## 4. Test/qualification contract

New tests reproduce the four-event probability-head contamination in production-derived fixtures, verify fail-closed future snapshot storage, and show legacy rows are excluded from probability training without rewriting raw frozen values. Other tests cover event/home-away mismatch, sum-to-one and regulation mass, cutoff failure, missing component, goalie/PIT confirmation, deterministic pure shadow, no synthetic weights, unvalidated fit, and wager fail-closed behavior on absent quote, settlement rules, probability, and unsafe spread/total.

The offline walk-forward script intentionally refuses to run without a supplied set of independently verified immutable pregame triple-head snapshots with disjoint chronological seasons. It never self-promotes fitted coefficients.

### Explicit gates

| Gate | Decision |
|---|---|
| Three-head SHADOW integrity mechanics | GO for isolated review after CI |
| October 10 exact frozen-record probability-source defect | GO — source isolated to generic fallback; no historical rewrite |
| Existing tracker Brier interpreted as PRO-v2 calibration | STOP — legacy hybrid probability records excluded |
| Three-head predictive improvement | STOP — no joint PIT test population |
| Three-head calibration/weights | STOP — no validated fitted artifact |
| Market/economic qualification | STOP — no verified matched execution quote plus prospective CLV |
| Production integration / deployment | STOP — separate operator approval required |
| Wagering authority / champion promotion | STOP — unchanged |

## 5. Remaining work and rollback

1. D1 tracker rows and four exact event IDs were recovered read-only. The separate immutable goalie archive yielded source PRO-v2 pregame probabilities and code SHA for Buffalo/St. Louis/Florida but no Calgary row; these records have different freeze timestamps. Recover exact simultaneous model-head values for Calgary and confirm timestamp alignment for same-checkpoint comparisons. Historical tracker probability columns must not be rewritten.
2. Independently verify confirmed starter sources (including their true publication time) and rate of mismatched goalie starts before considering wider deployment.
3. Assemble a strict PIT historical cohort with all three archived predictions produced before each corresponding game, **not** reconstructed using later rosters or closing prices. Run the walk-forward and paired ablations, report negative results.
4. Current marketLineHistory rows do not provide independently verified execution availability or supported settlement-scope attestation, so the new quote gate is deliberately fail-closed until a validated, fresh actual executable quote source exists. Build OT-aware full-game puck-line and total distribution treatment before either of those markets can qualify.
5. Accumulate fresh immutable prospective SHADOW snapshots, calibrate and analyze paired Brier/log loss and economics on actual offered odds, then request separate operator promotion approval.

Rollback: revert the NHL-specific changes from this branch in a future authorized PR. Current deployed code, model champions, historical predictions and sportsbook authority are untouched. The existing goalie shadow archival table schema is unchanged.
