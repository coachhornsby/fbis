# NBA-FBIS-v1 Research Program

Status: VALIDATION / PROSPECTIVE QUALIFICATION
Production wager authorization: false
Primary objective: generate positive closing-line value (CLV) and positive ROI after vig using independent NBA game projections.

## Governing principle

NBA-FBIS-v1 is not optimized to mimic the market. Market prices are reserved for evaluation, edge calculation, calibration checks, and wager qualification. They are not model features.

## Licensing / data boundary

Production-safe inputs must have an approved data-use path.

Allowed for initial research:
- ESPN-derived schedules, results, box scores, rosters, play-by-play, shot locations where exposed through SportsDataverse/hoopR.
- Internally derived features computed from approved raw inputs.
- Official NBA injury reports as availability-state research inputs, subject to ingestion review.

Research-only / quarantined until licensing approval:
- NBA Stats API-derived lineups.
- NBA Stats API-derived tracking.
- NBA Stats API-derived advanced player/team statistics.
- NBA Stats API-derived possession tables.
- NBA Stats API-derived shot dashboards.
- Any derivative whose only source is an NBA Stats endpoint.

No research-only field may become a production dependency by transitive derivation.

## Model target

The model produces:
- expected home points
- expected away points
- expected possessions
- expected margin
- expected total
- home win probability
- cover probability at a supplied market spread
- over probability at a supplied market total

Market lines enter only after the independent projection is frozen for that timestamp.

## Core architecture

### 1. Possession engine
Estimate expected game possessions from:
- opponent-adjusted recent pace
- season pace prior
- matchup interaction
- rest
- back-to-back status
- travel / time-zone state
- overtime exclusion from regulation-rate features

### 2. Efficiency engine
Estimate offensive points per 100 possessions against the opponent using:
- opponent-adjusted offensive efficiency
- opponent-adjusted defensive efficiency
- eFG components
- turnover rate
- offensive rebound rate
- free-throw rate
- shot-profile interaction derived from approved PBP/shot coordinates
- recency-weighted form with shrinkage to longer-run priors

### 3. Availability engine
Represent player availability without guessing:
- OUT
- DOUBTFUL
- QUESTIONABLE
- PROBABLE
- AVAILABLE

Player impact enters only when a historical, timestamped availability state can be reconstructed without future leakage.

Initial player-value implementation should use approved box-score/PBP-derived on-court contribution proxies. NBA Stats lineup/tracking impact remains quarantined.

### 4. Schedule / fatigue engine
Explicit features:
- days rest
- back-to-back
- 3-in-4
- 4-in-6
- road-trip game number
- distance traveled
- time-zone change
- altitude destination indicator
- home/away sequence

### 5. Home-court engine
Do not use a permanent league-wide constant.
Estimate NBA home court hierarchically:
- league baseline
- team/venue shrinkage
- season drift
- rest/travel interaction
- altitude interaction

### 6. Uncertainty engine
Produce a score distribution, not only a point estimate.
Minimum:
- margin standard deviation
- total standard deviation
- calibrated win/cover/over probabilities

## Initial model families

Baseline A:
- regularized linear / ridge possession + efficiency model

Baseline B:
- gradient-boosted trees on the same temporally valid feature set

Candidate C:
- ensemble of A and B with weights selected only from walk-forward validation

No deep-learning model is justified until the simpler models are demonstrably saturated.

## Temporal integrity

Every training row must be reproducible as of its game-time snapshot.

Forbidden:
- season-end aggregates applied to earlier games
- injury outcomes learned after tipoff
- closing lines used as model features
- postgame roster/lineup knowledge used pregame
- rolling statistics that include the target game
- repaired historical data without an as-of timestamp when the repair changes information that was unavailable pregame

## Backtest design

Use true walk-forward evaluation by season and date.

Primary score-model metrics:
- margin MAE
- total MAE
- RMSE
- winner accuracy
- probability Brier score
- probability log loss
- calibration error

Betting metrics:
- closing-line value
- ROI after vig
- units won
- max drawdown
- bet count
- hit rate
- performance by edge bucket
- performance by market type
- performance by rest/availability regime

A model does not qualify because of winner accuracy alone.

## Qualification gates

NBA-FBIS-v1 is qualification-eligible, but qualification remains point-in-time and evidence-driven. The following gates govern promotion/authorization:

1. Data provenance
   - all production features have approved source classifications.
2. Temporal integrity
   - zero known leakage in audited samples.
3. Walk-forward superiority
   - beats naive team-strength and simple rolling-efficiency baselines on margin/total error.
4. Calibration
   - probabilities are acceptably calibrated out of sample.
5. Market value
   - positive CLV across a meaningful sample.
6. Economic value
   - positive ROI after vig, with uncertainty intervals reported.
7. Stability
   - no single season, team, or narrow edge bucket explains the result.

## Betting authorization

Research projections may be displayed as RESEARCH.

No wager is authorized until:
- projection timestamp precedes the evaluated market timestamp,
- market is available and valid,
- edge exceeds a threshold selected on prior validation only,
- uncertainty and minimum-price rules pass,
- the model is production-qualified.

## Planned feature tiers

Tier 1 — production-safe candidate set
- ESPN schedule/results
- ESPN box scores
- ESPN PBP
- ESPN shot coordinates where available
- approved public injury/availability feed
- internally computed rolling team/player features
- rest/travel/calendar features

Tier 2 — research-only license review
- NBA Stats lineups
- tracking
- advanced player/team statistics
- possession tables
- shot dashboards
- defensive matchup / closest-defender data

Tier 2 must prove incremental out-of-sample value before any licensing effort is treated as worthwhile.

## Promotion policy

Champion status is earned against the current NBA baseline, not assigned by model complexity.

Promotion requires:
- reproducible research artifact
- source manifest
- feature manifest
- walk-forward report
- leakage audit
- calibration report
- CLV/ROI report
- explicit canQualify=true governance change

Current governance:
- model_id = NBA-FBIS-v1
- state = VALIDATION
- canQualify = true
- wagerAuthorization = false


## Game-level wagering architecture

The wagering layer does not bet historical buckets. It evaluates each offered NBA wager at a specific decision timestamp.

Decision sequence:

1. Freeze the independent NBA-FBIS-v1 projection and uncertainty distribution.
2. Preserve the projection decomposition explaining the model's margin/total view.
3. Join only market observations that existed at or before the decision timestamp.
4. Require an actual offered line and actual American price before calculating break-even probability or EV.
5. Derive ordinary market trajectory from immutable sportsbook snapshots: open/current movement, velocity, persistence/reversal, and FBIS edge expansion/decay.
6. Join ACTION only as a separate Wager Intelligence layer.
7. Estimate model probability, break-even probability, EV, uncertainty, matchup reliability, data quality/freshness, historical analogue reliability, market confirmation/opposition, and FBIS Confidence.
8. Produce BET/PASS for the individual offered wager.
9. Closing information is joined only after the fact for CLV and grading.
10. Stake units remain null until a staking policy is prospectively validated.

Historical subsets are evidence for calibration/reliability only. They never directly generate a wager.

### ACTION acquisition and authority rules

NBA does not receive a dedicated ACTION paid pull.

FBIS uses the existing shared daily ACTION acquisition contract:

- exactly one successful paid full-slate ACTION acquisition per Chicago day;
- the run covers the active MLB/NFL/NBA/NHL/CFB/CBB slate;
- START never replaces an existing paid Actor run;
- HARVEST resumes the same run until persistence completes;
- monthly/daily spend guards, shared Apify cap, leases, cooldowns, and circuit rules remain authoritative;
- the base daily payload keeps paid movement history, props, injuries, and standings disabled;
- ACTION observations are append-only and snapshot labels are derived without rewriting observations.

ACTION may supply market context such as opening/current information, ticket %, money %, money-ticket divergence, and provider market movement. FBIS may locally derive confirmation/opposition, reverse-line movement, or steam-like behavior from those observations.

ACTION is never:
- a PURE NBA model feature;
- a direct wager qualifier;
- wager authorization;
- a reason to start another paid collection.

If ACTION is missing or stale, the NBA model still exists. The decision record notes the missing Wager Intelligence context and relies on executable sportsbook market data for price/EV.

### Confidence governance

FBIS Confidence is provisional until graded prospective decisions demonstrate monotonicity.

A confidence calibration requires at least 50 graded decisions and at least three populated confidence bands. The calibration checks win rate, ROI, and CLV behavior by confidence band. If higher confidence does not generally correspond to better outcomes, confidence remains invalid for staking and is recalibrated.

Primary wagering validation metrics are:
- units;
- ROI;
- CLV;
- probability calibration;
- max drawdown;
- stability through time;
- confidence monotonicity.

Projection MAE remains a diagnostic, not the wagering objective.


## Player impact and lineup architecture

NBA-PLAYER-PROP-v1 consumes a separate FBIS-native player-impact layer: NBA-FBIS-PLAYER-IMPACT-v1.

Primary research benchmark:
- EPM.

Secondary research benchmarks:
- DARKO.
- RAPM.
- VORP.
- WS/48.

External published metrics are benchmark-only and are never required production inputs.

Production-safe player-impact construction:
- exponentially decayed dynamic skill estimates by stat;
- SPM-style box-score prior;
- regularized adjusted plus/minus from approved PBP-derived lineup stints;
- raw on/off diagnostic;
- regularized five-man lineup effects;
- three-man core effects;
- player-pair effects;
- with/without teammate context;
- expected minutes redistribution;
- usage, assist, rebound and three-point opportunity redistribution.

The FBIS impact layer is inspired by the methodology class used by modern predictive impact metrics, but it does not reproduce or relabel proprietary EPM/DARKO formulas.

Impact-context promotion requires incremental true walk-forward value against the existing prop baseline. Injury-driven redistribution remains prospective-only until timestamped historical availability is sufficient to backtest without target-game leakage.


## NBA-FBIS-v2-DEEP game challenger

The next game-model layer is implemented as a residual challenger over NBA-FBIS-v1 rather than an in-place replacement.

New independent pregame feature families:
- opponent-adjusted Four Factors: eFG%, turnover rate, offensive-rebound rate and free-throw rate;
- PBP-derived shot mix and shot-efficiency profiles;
- actual prior-venue to current-venue travel, rest, time-zone and altitude context;
- expected lineup offense/defense/net impact and continuity;
- point-in-time official availability context;
- learned nonlinear matchup interactions.

Historical fitting used 2024-25 only. The untouched 2025-26 holdout contained 1,322 games. Relative to NBA-FBIS-v1, v2-DEEP improved total MAE by 3.50% and winner accuracy slightly, but margin MAE regressed 0.85%. Therefore it remains a non-qualifying prospective shadow challenger.

The 2025-26 holdout is now burned and may not be reused for further tuning. Promotion requires 2026-27 prospective evidence.

### Official NBA availability

The production availability adapter uses only NBA official injury-report PDFs from the league's referee/injury archive. Each report is archived immutably. Player rows are normalized into `player_availability_observations`, while team submission state is stored separately.

A team is availability-verified only when its official report is submitted. `NOT YET SUBMITTED` explicitly remains unverified. A submitted team with zero listed injuries is treated as verified healthy rather than missing data.


## Persistent team profiles

NBA team state is no longer rebuilt from zero each day. FBIS maintains a persistent profile for all 30 teams and each rostered player.

State hierarchy:
1. official NBA injury report;
2. official NBA live lineup / active-status evidence;
3. actual game appearance;
4. prior persistent state carried forward;
5. roster-only fallback.

An OUT/Doubtful/Questionable status remains active until newer evidence supersedes it. Calendar age alone never clears an injury. Confirmed ACTIVE/STARTER lineup evidence or an actual game appearance can clear a carried absence.

Each team profile contains:
- roster and current player state;
- projected rotation / role hierarchy;
- replacement candidates for unavailable players;
- player-impact context;
- head coach and coach experience context;
- recent team style;
- preseason + full regular-season schedule;
- venue-to-venue travel path;
- rest days, B2B, 3-in-4 and 4-in-6;
- time-zone changes and altitude;
- road-trip position;
- schedule stress score and explicit weak-spot reasons.

Coach descriptors and schedule-stress scores are context-only until prospective validation demonstrates incremental wagering value. The deep game model already uses independent rest/travel/altitude features; persistent profiles provide continuity and explainability rather than a second unvalidated adjustment.

Profile updates are timeout-safe: six independent five-team source shards merge into one short state-build step. Current profiles are written to D1 and R2, with immutable D1/R2 snapshots retained for audit.
