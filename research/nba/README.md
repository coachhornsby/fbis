# NBA-FBIS-v1 Research Program

Status: RESEARCH ONLY
Production eligibility: false
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

NBA-FBIS-v1 remains canQualify=false until it passes all gates:

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

Until then:
- model_id = NBA-FBIS-v1
- state = RESEARCH
- canQualify = false
- wagerAuthorization = false
