# CFB V2 Phase 5 — Prospective qualification and independent evidence audit

## Input evidence (2026-10-22 before first 2026 weekend results)
- 51 unique `cfb_drive_shadow_runs` receipts (21 Phase 3 + 30 Phase 4 automated).
- Each ran 1,000 regulation-only draws with 60 verified CFBD games / 1,347 historical drives.
- 0 graded results; all 51 kickoff future at the time of initial audit.
- Source collection exists on the scheduled `.github/workflows/college.yml` 07:30 America/Chicago daily owner (`cfb-postgame-harvest`). The optional /drives path remains **quota gated**, and its ingest validation rejects unsupported scoring and OT games. Phase 5 does not add external fetches or change the shared allowance.

## Phase 5 evidence design

The protected `GET /api/cfb-simulation?mode=qualification` runs `cfbDrivePhase5Audit` in the **already existing CFB_DB**. It is read-only; no new migration, third-party API, user-facing wager probability or shadow-to-champion routing.

### Strict sample denominator
1. Include only records genuinely frozen before each game's kickoff, with `RESEARCH_SHADOW_ONLY` authority and `can_authorize_wager=0`.
2. Count each game once, selecting the earliest valid pre-kickoff V2 research receipt; multiple runs must **never** masquerade as independent observations.
3. A game is only graded if an authentic `cfb_drive_shadow_grades` row has a matching **current immutable verified game-source fingerprint**, `verified_against_game=1`, `period_scope=REGULATION_ONLY`, `source_observed_at>kickoff`, finite scores and kickoff already passed.
4. Separate **future / started / still-ungraded / overdue** from valid scored games. Mark results overdue for source collection only after 36 hours. Never interpret ungraded or unsupported overtime as a simulation success/failure; preserve attrition in the denominator.
5. Fail closed if D1 is unbound, clock invalid, result invalid, or the 500-record page cap is reached. No partial report should be mistaken for full evaluation.

### Accuracy and calibration
- Fair **paired** total and margin absolute error: unchanged original CFB-FBIS-v2 frozen baseline versus V2 mean, on exactly the same scored games.
- Difference in MAE (baseline absolute error minus V2 error), deterministic 2,000-replicate **paired bootstrap 95% percentile interval**, only when at least 30 independent grades exist.
- Actual 80%/90% score-total and margin interval coverage, with 95% Wilson binomial uncertainty intervals.
- Result capture for games at least 36h past kickoff, with Wilson bounds.
- Compare 30+ distinct grades from **at least two different kickoff dates** with at least 75% verified capture of overdue games and **no invalid receipts or grades** for `researchEvaluable`.
- Even research-evaluable is **not wager-authorized**. A favorable research signal additionally requires both paired 95% improvement lower bounds to be strictly positive and nominal interval coverage to exceed conservative research floors (80%-interval >=65%; 90%-interval >=80%). This is deliberately stricter than a single-point estimate, and still not a promotion decision.
- Missing grades, bootstrap intervals, or evidence cannot be silently imputed. All reported unobserved metrics are null, not zero.

### Daily production audit
`.github/workflows/cfb-v2-phase5-qualification.yml` starts once on the dedicated successful main-branch release, then at 21:00 UTC (16:00 CT daylight, 15:00 CT standard) each day through December 10. The Phase 4 new-event workflow starts 16:00 UTC and source-verified grading 19:00 UTC through November 20.

Outputs: sanitized GitHub Actions summary and 30-day retention JSON artifact with evidence rates, paired score errors, calibration, uncertainty, qualification gates, and non-wager/non-promotion indicators. No raw CFBD data, secrets or user-facing betting positions.

## Scientific constraints
This is a possession-level conditional empirical resampler, **not** full player-resolved play-by-play modeling. NCAA OT, correlations that rely on lineup/personnel, team-specific style priors, validated market moneylines, and actual betting results are excluded. The as-of research challenger preserves earlier champion score forecasts without rerunning them after new source observations. No inference of superiority, profitability or financial edge can be made until enough actual finished and verified games accrue.

## Tests
`node --test test/cfb-drive-phase5-qualification.test.js`; CFB Drive Simulation V2 and Shadow Simulation Contract suites; full CI and Pages production SHA verification; one-shot workflow execution and independent CFB_DB audit counts.
