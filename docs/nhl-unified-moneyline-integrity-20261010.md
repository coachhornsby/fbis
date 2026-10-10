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

### October 10 discrepancy diagnostics

These are **not** immutable tracker reproductions. The four submitted rounded projected scores, run through the PRO-v2 bivariate-Poisson/OT mathematical definition, give:

| Home team | Reported mean home/away | Score-only P(home) | Tracker home P | Maximal final formula interval* |
|---|---|---:|---:|---:|
| Buffalo vs Utah | 3.3 / 3.2 | 0.5226 | 0.304 | [0.4054,0.6248] |
| Calgary vs Anaheim | 3.3 / 3.1 | 0.5453 | 0.245 | [0.4207,0.6400] |
| St. Louis vs Columbus | 3.2 / 3.1 | 0.5229 | 0.669 | [0.4054,0.6252] |
| Florida vs Minnesota | 3.4 / 3.1 | 0.5671 | 0.703 | [0.4356,0.6542] |

*Conservative interval: each displayed team goal mean allowed ±0.05 (one-decimal rounding), and Elo probability allowed the entire [0,1] range before the PRO-v2 78/22 blend and outer shrinkage. Numerical integration uses the same 0–11 team-specific Poisson counts and 0–5 shared component. All four tracker percentages are outside these intervals. Thus, **the documented PRO-v2 blend alone cannot explain the combination of those displayed means and percentages**. Exact event IDs/frozen tracker records have not been recovered; causes such as a different model head, mismatched version, stale snapshot, or reversed team must be proven individually, not assumed.

## 2. Changes

- `nhlUnifiedMoneylineShadow.js`: validates canonical event/team identity, feature cutoff prior to start, positive scoring means, regulation distribution mass, complementary full-game probabilities, unmodified projection, and component alignment. Publishes explicit PRO-v2, WIN-v1 and goalie shadow inputs. No combined probability is supplied without an independently validated fitted calibration artifact. Even an accepted fitted artifact returns research-only outputs with no authorization.
- `nhlProV2.js`: stamps event ID, game start and feature-cutoff timestamp. A goalie explicitly marked `CONFIRMED_STARTER`, with source-observed timestamp before both feature cutoff and game start, supersedes the highest-start-count proxy. Missing, late, or unverified evidence retains the pre-existing historical proxy, now explicitly labeled as such.
- `nhlGoalieProbabilityShadow.js`: adds confirmed/projected/proxy status, source timestamp and lineup alignment; removes wall-clock-dependent `featureCutoffTimestamp` from the pure projection result.
- `slateEngine.js`, `todayBoard.js`: wire the three-head shadow into research response, without setting generic `pHomeFinal` or changing champion authority. Board eligibility follows wager qualification and cannot be bypassed merely by an attached NHL-PRO-v2 research object.
- `nhlWagerV1.js`: remove silent moneyline fallback when its stored probability is missing/invalid; validate source identity and complementary heads; require exact matched pre-start same-book two-way odds plus explicitly verified full-game settlement scope; require calibrated probability lineage and valid goalie evidence before qualification. Regulation-derived spread and total research rows can no longer qualify without OT-aware settlement handling. Legacy provisional probability/EV columns remain for *research only* and are marked unvalidated.
- `nhl-goalie-shadow.js`: store the three-head diagnostic vector, lineage and any research candidate inside the existing immutable `temporal_integrity_json` of future goalie shadow records, without a migration. This is an adjunct to existing goalie shadow evidence, **not** a separately qualified or exhaustively collected unified probability cohort.
- `nhlUnifiedMoneylineResearch.js`, `nhl-unified-moneyline-walkforward.mjs`: implement a PIT-fail-closed offline candidate set (incumbent, score only, calibrated incumbent, independent WIN, goalie only, each two-head combination, all three) using regularized logistic stacking, chronological train/validation/untouched-test seasons, paired Brier bootstrap, log loss, accuracy, ECE and diagnostic calibration fit, season and goalie-state splits. Refuse unsafe or insufficient historical inputs. The output is `UNQUALIFIED_SHADOW_RESEARCH` regardless of apparent success.

## 3. Measured existing historical evidence (not a new unified-model result)

**NHL-WIN-v1 validation artifact:** `data/models/nhl-win-v1-validation.json` reports 1,312 games in its 2025–26 test season. Incumbent Brier 0.24567/log loss 0.68425; logistic head Brier 0.25096/log loss 0.69582; calibrated logistic Brier 0.25353/log loss 0.70212. Its directional accuracy improvements do not justify substituting its uncalibrated score for moneyline probability.

**Goalie historical expansion:** `data/models/nhl-goalie-prob-historical-expansion-v1.json` reports 4,574 usable 2019–23 games. Incumbent Brier 0.233971/log loss 0.660366/ECE 0.028226; goalie shadow Brier 0.234220/log loss 0.660886/ECE 0.035699. Paired Brier delta +0.00024931, reported 95% interval [-0.00023725,+0.00075949]. Additional historical goalie probability is not established as an improvement.

**No validated three-head joint PIT dataset** was available for this branch. The point-in-time model versions overlap imperfectly, and reconstructing old feature snapshots from postgame aggregates would contaminate the test. No three-head weights, numerical combined probability, OOS superiority, or market edge are claimed.

## 4. Test/qualification contract

New tests cover event/home-away mismatch, sum-to-one and regulation mass, cutoff failure, missing component, goalie/PIT confirmation, deterministic pure shadow, no synthetic weights, unvalidated fit, and wager fail-closed behavior on absent quote, settlement rules, probability, and unsafe spread/total.

The offline walk-forward script intentionally refuses to run without a supplied set of independently verified immutable pregame triple-head snapshots with disjoint chronological seasons. It never self-promotes fitted coefficients.

### Explicit gates

| Gate | Decision |
|---|---|
| Three-head SHADOW integrity mechanics | GO for isolated review after CI |
| October 10 exact frozen-record provenance | STOP — frozen records/event identity still needed |
| Three-head predictive improvement | STOP — no joint PIT test population |
| Three-head calibration/weights | STOP — no validated fitted artifact |
| Market/economic qualification | STOP — no verified matched execution quote plus prospective CLV |
| Production integration / deployment | STOP — separate operator approval required |
| Wagering authority / champion promotion | STOP — unchanged |

## 5. Remaining work and rollback

1. Recover immutable October 10 tracker rows, exact event/team IDs, projection SHAs, source cutoff and probability field labels, then compare frozen PRO-v2 components against displayed probability.
2. Independently verify confirmed starter sources (including their true publication time) and rate of mismatched goalie starts before considering wider deployment.
3. Assemble a strict PIT historical cohort with all three archived predictions produced before each corresponding game, **not** reconstructed using later rosters or closing prices. Run the walk-forward and paired ablations, report negative results.
4. Validate two-way full-game sportsbook settlement definition, quote price, bookmaker, availability, and timestamp; build an OT-aware full-game puck-line and total model before those markets can qualify.
5. Accumulate fresh immutable prospective SHADOW snapshots, calibrate and analyze paired Brier/log loss and economics on actual offered odds, then request separate operator promotion approval.

Rollback: revert the NHL-specific changes from this branch in a future authorized PR. Current deployed code, model champions, historical predictions and sportsbook authority are untouched. The existing goalie shadow archival table schema is unchanged.
