# FBIS-CFB — College Football Projection & Market Intelligence System

**Comprehensive Technical & Operating Manual**  
**Version:** 1.0  
**Status:** Canonical CFB specification  
**Parent standard:** `docs/FBIS-MODEL-SYSTEM-STANDARD.md`

## 1. System purpose and philosophy

FBIS-CFB is a point-in-time-safe college-football forecasting and market-research system. Its long-term objective is to improve independent prediction quality enough to add information beyond the closing market. Its immediate research objective is to identify repeatable, temporally valid conditions in which FBIS residual error is lower than the market's.

The system is model-first and evidence-gated:
- football information creates the independent projection;
- market information evaluates that projection;
- matchup/context explains where the projection may be strong or fragile;
- qualification is a separate permission;
- no research result automatically authorizes a wager.

## 2. Supported outputs and markets

Game projection outputs:
- projected home score;
- projected away score;
- projected margin;
- projected total;
- winner/win probability where supplied by the active model;
- uncertainty state.

Market evaluation:
- spread;
- total;
- moneyline/no-vig probability when adequate prices exist.

Player layer:
- CFB-PLAYER-v1 currently focuses on QB1/RB1/WR1 projections and coherence with team scoring/rushing/receiving totals.
- Player markets remain separate from game-model qualification.

## 3. Source catalog and roles

### 3.1 CFBD / CollegeFootballData
Validated families used or audited by FBIS include:
- SP+, FPI, SRS, Elo and CORE where a valid point-in-time snapshot exists;
- team/game/player PPA;
- advanced game statistics;
- weather;
- lines;
- talent;
- returning production;
- recruiting;
- transfer portal;
- roster;
- coaches;
- plays;
- drives;
- scoreboard.

Not every endpoint is historically safe. Availability does not imply eligibility.

### 3.2 SportsDataverse / cfbfastR
The full-history v3 research corpus uses derived game/team/player history beginning in 2004 where available:
- schedules/results;
- advanced offense;
- passing and primary-QB state;
- rushing/receiving;
- defense/turnovers;
- drives/situational football;
- specialists/special teams;
- team box;
- power index;
- resolved historical betting benchmark.

### 3.3 Market history
Two historical benchmark families are retained:
1. SportsDataverse/ESPN resolved line.
2. CFBD provider-level line history (2013-current where available).

The canonical historical benchmark prefers resolved SportsDataverse/ESPN and uses provider-median CFBD consensus as fill. Raw provider rows remain available for audit.

**Market data is evaluation-only for independent CFB models.**

## 4. Identity normalization

All source teams, games, players, providers and seasons must resolve to canonical FBIS identities before joining features or markets. Ambiguous event identity reduces quality and cannot be silently coerced.

Player-role resolution must preserve the evidence used to infer QB1/RB1/WR1 and the source games behind that inference.

## 5. Temporal integrity and provenance

CFB uses strict pre-kickoff eligibility.

Hard rules:
1. Post-kickoff data never enters a pregame vector.
2. Prior-season features must identify the actual source season.
3. Rolling observations preserve source game ID and kickoff.
4. Weekly ratings/FPI must come from a snapshot strictly before the target game/week.
5. CORE uses actual `throughWeek`/`throughSeasonType`; FBIS never invents a week-bounded snapshot.
6. Market lines cannot enter the independent feature matrix.
7. Missing provenance fails closed.

Historically unsafe without reconstruction:
- `/stats/season/advanced`
- `/ppa/players/season`
- `/player/usage`
- `/stats/player/season`
- `/ppa/teams`

Undated same-season SP/FPI/SRS/Elo must use a prior-season freeze when contemporaneous state cannot be proven.

Canonical audit: `docs/cfb-temporal-audit.md`.

## 6. Independent feature architecture

### 6.1 Structural/program prior
Candidate/available program-strength information includes:
- prior-season SP+/FPI/SRS/Elo;
- talent composite/rank;
- returning production;
- recruiting history/projections;
- transfer/roster state;
- coaching continuity/change.

### 6.2 Current football strength
Point-in-time reconstructed families include:
- EPA/PPA;
- success rate;
- pass/rush efficiency;
- explosive-play production/prevention;
- early/standard-down efficiency;
- drives and finishing behavior;
- turnovers;
- pressure/sack/havoc proxies where available;
- pace/play volume;
- special teams.

### 6.3 Recent state
Season-to-date and rolling windows may coexist only when each observation is shifted and cutoff-safe. Recent form is evidence, not a narrative override.

## 7. Projection model architecture

### 7.1 CFB-FBIS-v2
Documented architecture:
**prior -> rolling n/(n+k) -> matchup -> QB residual -> context/HFA -> score**

v2 calibration used rolling-origin ridge and selected the simplest ablation within the predefined MAE tolerance. Historical v2 documentation remains an audit record, not permission to overwrite newer research.

### 7.2 CFB-FBIS-v3-research
Current research package:
- model ID: `CFB-FBIS-v3-research`;
- role: research;
- market informed: false;
- canQualify: false;
- trained through 2025;
- separate regularized margin and total estimators;
- expanding chronological validation;
- train-only feature screening/collinearity handling/tuning.

The checked-in model package is `data/models/cfb-fbis-v3-research.json`.

### 7.3 Next architecture target — matchup/context upgrade
The next CFB challenger should strengthen:
- opponent-adjusted offense/defense;
- QB continuity and production;
- returning production and roster turnover;
- talent differential;
- transfer impact;
- coaching/coordinator continuity;
- conference/opponent strength;
- explosives;
- havoc/pressure/protection;
- run/pass interaction effects;
- travel/rest;
- team/venue-specific HFA where evidence supports it;
- projection uncertainty.

No feature enters production merely because it is football-plausible; it must survive temporal validation.

## 8. Football matchup engine

The matchup layer should represent interactions rather than isolated team ranks.

Primary interaction families:
- pass offense × pass defense;
- rush offense × rush defense;
- pressure/havoc × protection/sack avoidance;
- explosive offense × explosive prevention;
- early-down offense × early-down defense;
- finishing drives offense × red-zone/finishing defense;
- pace × opponent pace/game-state tendencies;
- QB state × opposing pressure/coverage proxies;
- OL continuity × front disruption;
- special teams × field-position environment.

These features belong in independent football modeling only when constructed without market information.

## 9. Player and availability state

High-impact state includes:
- starting QB identity/change;
- backup-QB uncertainty;
- QB recent/rolling production;
- OL continuity;
- RB/WR/TE availability and usage;
- defensive front/secondary availability;
- transfers, suspensions and opt-outs when timestamped before kickoff.

Unknown is not healthy. Missing high-impact availability must raise uncertainty or fail the affected component closed.

CFB-PLAYER-v1 role reconstruction must use only pre-kickoff source rows.

## 10. Uncertainty and missing data

Every game must carry an uncertainty/quality state derived from model residual uncertainty plus data completeness.

At minimum distinguish LOW/MEDIUM/HIGH or an equivalent calibrated continuous measure.

Drivers include:
- missing priors;
- weak FCS identity/history;
- uncertain QB/role state;
- sparse current-season sample;
- incomplete matchup features;
- weather uncertainty;
- model disagreement/out-of-distribution feature state.

Uncertainty is part of qualification evidence; it cannot be hidden by a large raw edge.

## 11. Market roles

CFB inherits `docs/market-roles.md`:
1. FBIS PURE.
2. EXECUTION_MARKET.
3. CONSENSUS / MARKET_INTELLIGENCE / OBSERVED.
4. REFERENCE_MARKET.

Closing/historical lines are benchmarks only. Consensus cannot fabricate an executable offer.

## 12. Market research / residual edge layer

After an independent projection is frozen, research may compute:
- spread disagreement;
- total disagreement;
- no-vig moneyline disagreement;
- model absolute error vs market absolute error;
- line movement and CLV;
- residuals conditional on football context.

Primary residual metric:
**market absolute error - FBIS absolute error**. Positive values indicate FBIS was more accurate for that observation.

The current coarse market-weakness study uses discovery through 2024 and holdout 2025-2026. It found **zero verified coarse subsets** under its predefined evidence gates. That is a valid negative result and must not be repaired by weakening thresholds.

Next research should emphasize predeclared football interaction regimes, not endless one-dimensional bucket mining.

## 13. Qualification / gatekeeper

Current research models remain:
- `canQualify: false`;
- automatic promotion disabled;
- automated wager authorization disabled.

A future CFB qualification policy must be derived from CFB evidence. Candidate inputs may include:
- independent projection edge;
- calibrated uncertainty;
- matchup support;
- data completeness;
- validated residual regime;
- executable price/value;
- market movement as downstream intelligence.

No numeric edge threshold from CBB or another sport is inherited automatically.

States:
- QUALIFIED
- RESEARCH
- PASS
- DATA_INCOMPLETE

Every decision stores reason codes.

## 14. Execution and units

Qualification does not create a bet unless an explicitly configured execution market has a fresh usable line and price.

FBIS records performance in units. Any staking schedule must be separately versioned and validated. Research projections do not imply a stake.

## 15. Prediction snapshot and audit schema

For every CFB game preserve:
- canonical game/team IDs;
- kickoff;
- prediction timestamp/cutoff;
- model ID/version and code SHA;
- source provenance;
- feature-set version;
- player-role/availability state;
- projected scores/margin/total/probability;
- uncertainty/data quality;
- qualification state/reasons;
- market observations by role;
- actual execution quote if used;
- final score;
- closing benchmark;
- margin/total errors;
- CLV and result if executed.

Pregame snapshots are immutable.

## 16. Historical validation

Required design:
- chronological expanding/rolling origin;
- no random split;
- train-only preprocessing and feature selection;
- untouched holdout;
- closing market benchmark only;
- paired comparisons on identical games;
- coverage reported explicitly.

The full-history v3 corpus currently reaches back to 2004 where source coverage permits. Market coverage is high but not complete; known gaps must remain explicit.

## 17. Prospective validation

A challenger that survives historical validation enters prospective research/shadow tracking before any expansion of wager authority unless an operator-approved cutover standard explicitly permits otherwise.

Prospective tracking freezes predictions before kickoff and later appends outcomes/close. No retroactive feature correction may rewrite the original prediction.

## 18. Metrics and benchmark hierarchy

Primary:
- margin MAE;
- total MAE;
- winner accuracy.

Probability:
- Brier;
- log loss;
- ECE/calibration.

Market-relative:
- closing-line residual advantage;
- CLV where a real entry exists.

Downstream:
- ATS/OU record;
- units.

ATS record and units describe betting outcomes; they do not replace predictive validation.

## 19. Continuous learning

CFB inherits `docs/continuous-learning-governance.md`.

The immutable prediction ledger is the learning population. Monitoring is automatic; self-modification is not.

Shared governance includes:
- daily monitoring;
- sample-gated recalibration;
- chronological challenger holdout;
- paired statistical gates;
- Bayesian residual-bias telemetry;
- online-learning shadow only;
- operator approval for promotion.

## 20. Promotion and rollback

Promotion requires:
- temporal-integrity pass;
- reproducible artifact/model package;
- predefined validation success;
- no material calibration regression;
- production compatibility;
- operator approval.

Promotion is distinct from wager authorization.

Rollback must restore the last known-good model/config without rewriting historical snapshots.

## 21. Production/research workflows

Current CFB workflow families include:
- `cfb-full-history.yml`
- `cfb-history-v3-end-to-end.yml`
- `cfb-bulk-history-v3.yml`
- `cfb-bulk-v3-smoke.yml`
- `cfb-program-context.yml`
- `cfb-rich-data-validation.yml`
- `cfb-cfbd-market-enrichment.yml`
- `cfb-market-checkpoint-repair.yml`
- `cfb-market-qualification.yml`
- `cfb-market-weakness.yml`
- `cfb-saturday-data-audit.yml`
- `cfb-v3-finalize.yml`

These workflows are evidence-producing infrastructure. A successful workflow does not itself imply a model is qualified.

## 22. Health, freshness and failure behavior

CFB must fail closed on:
- temporal/provenance violations;
- ambiguous event identity that could join the wrong game;
- missing critical independent features where no validated fallback exists;
- stale/missing execution quote for actionability;
- market data contamination of an independent vector.

Degraded-but-displayable states must be labeled, not silently upgraded.

Scheduled acquisition must be idempotent and quota-aware.

## 23. Operator presentation

A CFB board should show:
- matchup/kickoff;
- FBIS projected score/margin/total;
- model/version;
- uncertainty/data quality;
- model vs market disagreement;
- football matchup diagnostics;
- market role/freshness;
- qualification state and reason;
- executable offer only when one truly exists.

Research should be visibly distinct from QUALIFIED.

## 24. Known limitations and prohibited shortcuts

Known limitations:
- historical market coverage is incomplete in some seasons;
- some CFBD season endpoints are not point-in-time safe;
- player availability history is less complete than team/game history;
- FCS prior coverage can be sparse;
- current coarse market-regime research has not established a verified CFB subset advantage.

Prohibited:
- random-split validation;
- season-final data in historical pregame vectors;
- fabricated CORE snapshots;
- market lines in independent features;
- treating missing player state as healthy;
- using another sport's thresholds without CFB validation;
- p-hacking subsets until one passes;
- automatic model promotion or wager authorization.

## 25. Current registry/status

| Component | Role | Market informed | Can qualify |
|---|---|---:|---:|
| CFB-FBIS-v3-research | Game research challenger | No | No |
| CFB-PLAYER-v1 | Player research/projection layer | No for projection | No unless separately governed |
| CFB market weakness | Evaluation/meta research | Yes, downstream only | No |

Historical v2/v1.4 records remain part of lineage and audit history. The registry/code is authoritative if a status changes after this manual version.

## 26. Change log

### v1.0
- Normalized CFB to the FBIS Model System Standard.
- Consolidated existing v2/v3, temporal-integrity, market-role and continuous-learning rules.
- Made independent projection vs downstream market research explicit.
- Established football-specific matchup/player/uncertainty requirements.
- Recorded zero verified coarse CFB market regimes as a valid research result.
- Defined the next challenger direction as richer matchup/context interaction modeling rather than threshold loosening.
