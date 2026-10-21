# FBIS — all-sport simulation and calibration expansion

**Status: Stage 1 research foundation (not a production simulation rollout).**

## Goal
Install one auditable simulation/evaluation interface for all 11 FBIS sports, while retaining each sport's own generator, settlement rules, feature engineering, coefficients, authority gates and data pipeline. Reuse infrastructure, never automatically reuse predictive assumptions.

## Existing code we should extend, not duplicate
- `functions/lib/continuousLearning.js` — drift, recalibration, challengers and shadow governance.
- `functions/lib/propCalibrationResearch.js` — prospectively frozen binary prop calibration.
- `functions/lib/nflWeeklyResearchReport.js` — shadow-only research reporting.
- `functions/lib/canonical/economicCohorts.js` — market/economic analysis.
- `functions/api/player-prop-learning.js` — existing prop settlement/reporting.
- `functions/lib/snapshotLearning.js` — canonical pregame snapshots.
- Existing `sportDbShadow` / qualification logic — **do not change database authority**.

## Stage 1 deliverable
- `functions/lib/sportSimulationResearch.js`: all 11 registered sport units and risk cautions; reproducible seed-based generic simulation harness that **requires a caller-supplied sport-specific generator**; numerical 5/10/25/50/75/90/95 percentile distributions; strict interval and binary probability grading by sport + market + stat + version.
- Tests for all sports, reproducibility, pregame freezes, missing models, inconsistent statistics, official settlement, upper-tail miss frequency, binary calibration and cohort boundaries.
- Research-only flags; no database writes, no price reconstruction, no production forecast replacement, no wagers.

**Important:** This stage does not implement 11 real sport generators. It does not establish profitability. The generator contract preserves correlations within each full-game draw rather than independently generating each player line.

## Sport-specific generator roadmap

| Sport | Event simulation unit | Required domain treatment |
|---|---|---|
| NFL | Play/drive | Pace, score state, snap shares, depth chart, QB pressure and coverage, injuries, sacks and overtime |
| CFB | Play/drive | Tempo, spread/RPO option usage, NCAA stat conventions, roster volatility, overtime |
| NBA | Possession | Rotation/minutes, lineups, pace, shot profiles, rebounds/assists, overtime |
| CBB | Possession | Team-specific pace, foul trouble, rotation, college rules and data coverage |
| WNBA | Possession | Minutes, starter/bench roles, lineup effects, pace, overtime |
| MLB | Plate appearance | Confirmed lineups, starters, bullpen, defense, parks, weather, extra innings |
| NPB | Plate appearance | Japanese league-specific rules, lineup, pitcher usage, ties and extra innings |
| KBO | Plate appearance | Korean league rules, pitching, weather, ties, extra innings |
| NHL | Shot/goalie event | Starting goalie, shot quality, empty net, OT/SO result and contract-specific settlement |
| Soccer | Possession/shot | xG, lineups, tactical pace, cards, stoppage time, three-way vs qualification markets |
| Tennis | Point/game/set | ATP/WTA, surface, service/return, best-of format, tiebreaks, injury/retirement settlement |

All individual market families must be demonstrated to have actual supported source/settlement contracts before activation.

## Build sequence (separate bounded PRs)
1. **Inventory and adapter contracts** — verify each current production model, historical data, prospective snapshots and gaps. Record actual capability per sport; do not mark missing inputs as zero.
2. **Sport generators in shadow mode** — start NFL/CFB where play/usage modeling is most relevant; add basketball, baseball, NHL, soccer and tennis generators separately. Compare to existing champions with paired out-of-sample and prospective forecasts. Use common harness; avoid unverified canned distributions.
3. **Canonical evaluation and reporting** — connect immutable pregame snapshots to official outcomes and contemporaneous odds. Run coverage (50/80/90%), directional tail misses, bias/MAE, binary Brier/log loss and model-version cohorts. Account for correlated game-level observations in confidence intervals.
4. **Economic analysis** — use **existing** authorized execution ledger for CLV, fees, realized P/L, price-adjusted value, drawdown and ROI. Keep null without priced/settled evidence. Never treat win rate or interval coverage as economic edge.
5. **Operator UI** — all-sport scorecard with filtered sport, position/player archetype, market, cohort, version and sample. Show calibration receipts plus omissions, uncertainty and archived weekly snapshot receipts. Public-facing 'sim vs real' should show representative forecast plus distributions; a typical simulated game is *not* a guaranteed outcome.
6. **Validation and controlled adoption** — prospective holdouts, regression testing, resource limits, migration/deployment binding checks, publication integrity. Requires separate, explicit approval of any change to champion, prices, confidence stars, wagering, data-store authority or production route.

## Non-negotiable gates
- No post-start forecasts or retroactively manufactured prospective records.
- No duplicate event/subject/model/market/stat records; require snapshot and settlement evidence identifiers, and caller must choose canonical pregame snapshot.
- No "simulated ROI" substituted for executed price/fee evidence.
- Reject missing official settlement/identity; preserve nulls for unsupported metrics.
- Per-sport metrics cannot be pooled for promotion; small correlated samples remain descriptive.
- Shared framework never authorizes wager signals or independently publishes an active card.
- Do not change current 11-sport D1 shadow migrations; their read/write authority is independent.
- Avoid high-volume raw-simulation writes to D1; use bounded summaries and existing R2 archival/retention design after storage verification.

## Stage 1 run
`node --test test/sport-simulation-research.test.js`

Qualification and deployment readiness remain **unverified** until their own workflow receipts are inspected.
