# FBIS Model System Standard

**Status:** Canonical cross-sport specification  
**Version:** 1.1  
**Applies to:** MLB, NFL, CFB, CBB, NBA, WNBA, NHL, soccer, and every future FBIS sport/model.

## 1. Purpose

Every FBIS sport must be implemented and documented as a complete decision system, not merely a projection formula. A compliant sport has an auditable chain:

**source data -> point-in-time feature state -> independent projection -> matchup/context diagnostics -> uncertainty -> market comparison -> research/qualification gate -> execution quote -> immutable prediction snapshot -> grading/CLV -> continuous-learning evidence -> operator-approved promotion**

The sport manual is the authoritative specification for that implementation. Code and workflows must not silently contradict it.

## 2. Non-negotiable architecture

### Layer A — Independent projection
The primary FBIS projection is upstream of market information. Sportsbook lines, prices, public splits, market movement, closing lines, and derived market-implied features are prohibited from independent model inputs.

Required outputs, where meaningful:
- team/participant projection;
- margin or equivalent differential;
- total or scoring expectation;
- win probability;
- uncertainty/confidence state;
- model ID/version and prediction timestamp.

### Layer B — Sport-specific matchup/context
Each sport defines causal or structurally relevant matchup variables using only information available at prediction time. Descriptive tags explain the projection; they do not independently authorize a wager.

### Layer C — Market research
Market data may be joined only after the independent projection is frozen. This layer measures disagreement, residual advantage, price/value, movement, and closing-line performance. It is an evaluation and research layer unless a separately validated qualification policy says otherwise.

### Layer D — Qualification
A candidate may become actionable only through a versioned qualification policy supported by temporal validation. No threshold is production doctrine merely because it is intuitive or worked in another sport.

Canonical states:
- QUALIFIED
- RESEARCH
- PASS
- DATA_INCOMPLETE

Every nontrivial state must preserve reason codes.

### Layer E — Execution
Execution requires a usable quote from an explicitly configured execution provider. Consensus, observed, intelligence, or reference markets cannot be relabeled as executable prices.

### Layer F — Audit and learning
Every prediction must be reproducible from an immutable pre-event snapshot. Outcomes and market closes are appended after the event; they never rewrite the original state.

## 3. Required manual sections

Every sport manual must contain, in this order:

1. System purpose and philosophy
2. Market structure and supported markets
3. Source catalog and source roles
4. Identity/entity normalization
5. Temporal-integrity and provenance rules
6. Independent feature architecture
7. Projection model architecture
8. Sport-specific matchup/context layer
9. Player/participant state, when applicable
10. Uncertainty and missing-data behavior
11. Market roles and line/price semantics
12. Research/residual edge layer
13. Qualification/gatekeeper policy
14. Execution and staking semantics
15. Prediction snapshot and audit schema
16. Historical backtest design
17. Prospective validation
18. Metrics and benchmark hierarchy
19. Continuous-learning governance
20. Promotion/rollback governance
21. Production jobs/workflows
22. Health, freshness, and failure behavior
23. Dashboard/operator presentation
24. Known limitations and prohibited shortcuts
25. Current model registry/status
26. Change log

## 4. Data and temporal integrity

A historical row is eligible only when FBIS can establish that every independent input was available before the target event cutoff.

Required principles:
- provenance over inference;
- actual source timestamps/periods over assumed availability;
- rolling features shifted before target event;
- season-final aggregates cannot masquerade as historical pregame state;
- missing provenance fails closed when the feature could leak future information;
- post-event results may be labels only;
- market observations live outside the independent matrix.

Every sport must explicitly catalog historically unsafe endpoints/fields and the reconstruction rule, if one exists.

## 4A. Frozen canonical data snapshots

Large historical/provider acquisitions and expensive deterministic enrichment builds are data products, not model-test steps.

Required behavior:
- After a successful historical build, persist a versioned immutable canonical snapshot plus manifest/checksum, source coverage, schema version, build timestamp, and provenance summary.
- Model research, calibration, ablation, backtests, and challenger tests MUST consume an existing compatible frozen snapshot by default.
- Do not repeat paid API pulls, multi-season history downloads, or deterministic upstream enrichment merely because model code changed.
- Rebuild upstream data only when the source data, requested coverage window, schema/data contract, provenance rules, or upstream feature-generation logic changed; or when an operator explicitly requests a refresh.
- A model workflow must fail closed with a clear missing/incompatible-snapshot reason rather than silently launching a large acquisition.
- Separate workflows/jobs should own (1) acquisition/canonical snapshot creation and (2) model research/validation.
- Every model report must record the canonical snapshot ID/checksum it consumed so results are reproducible.
- The same rule applies to MLB, NFL, CFB, CBB, NBA, WNBA, NHL, soccer, and future FBIS sports.
- Frozen does not mean season-static. During an active season, each sport MUST publish append-only weekly/incremental snapshot versions that preserve prior historical rows, ingest newly available games/context, recompute only the causally affected rolling/enrichment tail where practical, rerun QA/provenance checks, and issue a new manifest/checksum.
- Never mutate an already published snapshot in place. A weekly refresh creates a new snapshot ID/version and retains lineage to its parent snapshot.
- Research and production reports MUST pin the exact snapshot version used. Historical backtests remain reproducible against their original snapshot even after later weekly refreshes.
- Weekly refresh jobs and model-validation jobs are separate concerns: refresh may create a new canonical snapshot; validation may only consume a compatible frozen snapshot and must not trigger acquisition implicitly.

## 5. Validation standard

Random train/test splits are prohibited for time-dependent sports forecasting.

Default hierarchy:
1. chronological/expanding walk-forward;
2. untouched future holdout;
3. prospective shadow tracking;
4. production consideration only after predefined evidence gates.

Feature screening, imputation, scaling, hyperparameter selection, calibration, and model selection must occur inside the appropriate training fold.

Report at minimum, where applicable:
- margin/differential MAE and bias;
- total MAE and bias;
- winner accuracy;
- Brier score;
- log loss;
- calibration error;
- benchmark residual advantage;
- CLV for executable tracked plays;
- ATS/OU or equivalent results as descriptive downstream evidence.

Profitability alone is not sufficient model validation.

## 6. Market benchmark discipline

Closing market is the primary efficiency benchmark where a reliable close exists. The objective is not to imitate the market; it is to determine whether the independent model adds information.

Research must distinguish:
- outcome accuracy;
- closing-line residual advantage;
- line-movement/CLV prediction;
- executable value at an actual offered line and price.

No market-derived variable may leak backward into a model designated independent.

## 7. Research and multiple testing

Subset discovery is research, not automatic qualification.

Rules:
- predeclare primary regimes/interactions where possible;
- preserve discovery and holdout separation;
- require adequate sample size;
- use uncertainty intervals;
- correct exploratory families for multiple testing when appropriate;
- do not loosen gates after seeing results merely to manufacture a winner;
- failed/zero-regime research is a valid result.

## 8. Qualification and wagering authority

Model quality, qualification, and wager authorization are separate permissions.

A model registry must expose at least:
- modelId;
- role;
- marketInformed;
- canQualify;
- production/champion status where applicable;
- training cutoff;
- validation reference.

Defaults for a new challenger:
- canQualify: false;
- automatic promotion: false;
- automatic wager authorization: false.

Operator approval is mandatory for promotion or policy changes that expand wager authority.

## 9. Uncertainty

Every sport must model or classify uncertainty rather than treating all projections as equally precise. Sources may include model residual variance, data completeness, player availability, lineup uncertainty, sample size, model disagreement, and environment uncertainty.

Missing high-impact state must increase uncertainty or fail closed; it must not be silently imputed as normal.

## 9A. Persistent-state weighting governance

Persistent team/player state may be collected, persisted, and exposed as context across all sports. It may not silently alter a production champion projection.

Hard rule:
- no state-derived numerical overlay may modify production unless it is tied to an explicit gate;
- the gate must pass leakage-safe historical validation;
- the same overlay must pass prospective shadow validation;
- operator approval is required before production application;
- until then, the overlay remains CONTEXT_ONLY or SHADOW;
- shadow projections must be frozen at the same timestamp and market snapshot as the incumbent for fair grading;
- a failed or ungated state feature remains research context and does not receive implicit weight.

Canonical overlay states:
- CONTEXT_ONLY
- SHADOW
- PRODUCTION_APPROVED

The shared enforcement contract is `FBIS-STATE-OVERLAY-v1` in `functions/lib/stateOverlayGovernance.js`.

This rule is structural, not numeric. Each sport must validate its own gate and overlay. For example, an NFL QB-personnel gate does not authorize analogous NBA/NHL/MLB adjustments.

## 9B. Canonical persistent-state contract

All sports that maintain persistent team/player/entity state inherit the structural contract `FBIS-PERSISTENT-STATE-v1` in `functions/lib/canonical/persistentState.js`.

Required fields for an immutable state observation:
- sport, entity type, entity ID, and state family;
- value/payload;
- source and evidence class;
- evidence rank supplied by the sport-specific policy;
- observed_at, effective_at, and ingested_at;
- optional expiry and supersession lineage;
- provenance and confidence.

The shared contract deliberately does **not** define sport-specific evidence weights or freshness windows. Those must be validated/configured by each sport. UNKNOWN remains a valid state and may not be silently converted into a normal/healthy state.

Migration `0070_fbis_cross_sport_evidence` adds the additive canonical state-observation ledger. Existing sport-specific state tables remain authoritative until explicitly migrated.

## 10. Market roles

Use the canonical FBIS hierarchy:
1. FBIS PURE — independent projection.
2. EXECUTION_MARKET — explicitly configured operator books.
3. CONSENSUS / MARKET_INTELLIGENCE / OBSERVED — comparison/context.
4. REFERENCE_MARKET — optional research benchmark.

Line and price remain coupled. A consensus quote cannot create executable EV.

## 11. Immutable learning ledger

For each prediction preserve:
- event identity and scheduled start;
- prediction cutoff/timestamp;
- model/version/code SHA;
- source/provenance state;
- feature/version identifiers;
- projected outputs and uncertainty;
- qualification state/reasons;
- observed market snapshot by role;
- execution quote/entry only when real;
- final result;
- closing benchmark;
- model errors;
- CLV and bet result when applicable.

The ledger is the population for learning; executed bets alone are not.

## 11A. Prospective evidence and economic grading

All prospective challengers should be representable by `FBIS-PROSPECTIVE-EVIDENCE-v1` in `functions/lib/canonical/prospectiveEvidence.js`.

A prospective evidence record must pin:
- sport/event identity and event start;
- pre-event snapshot timestamp;
- champion and challenger model/version;
- lifecycle and versioned gate;
- state/market snapshot IDs;
- source and market observation timestamps;
- exact code SHA;
- incumbent and challenger projections;
- temporal-integrity result;
- qualification and wager-authority flags.

Legacy, wrong-version, post-start, or future-observation rows must be excluded from promotion cohorts without mutating the original row.

The canonical downstream economic contract is `FBIS-ECONOMIC-GRADE-v1` in `functions/lib/canonical/economicGrading.js`. It standardizes no-vig probability normalization, probability CLV, binary calibration losses, unit profit/ROI, and drawdown calculation. Sports may set different qualification thresholds, but they must not redefine the meaning of these metrics.

Migration `0070_fbis_cross_sport_evidence` adds additive canonical prospective-evidence and economic-grade ledgers. Sport-specific evidence tables may continue in parallel while adapters are introduced.

## 12. Continuous learning

FBIS is self-governing, not self-modifying.

Monitoring may run automatically. Recalibration/challengers may be generated automatically under sample gates. Promotion and wager authority may not change automatically.

Use the repository's canonical continuous-learning governance for shared thresholds unless a sport manual documents a validated exception.

## 13. Production reliability

Each sport must document:
- scheduled ingest;
- projection/scanner jobs;
- snapshot cadence;
- grading;
- close/CLV capture;
- freshness thresholds;
- source fallback order;
- quota controls;
- retry/idempotency;
- fail-open vs fail-closed behavior;
- health checks and alerts.

Paid acquisition must have explicit run guards.

## 13A. Bounded and restartable production work

Long-running ingestion, backfill, grading, calibration, snapshot, and research jobs must be represented as bounded, durable work units rather than monolithic all-season/all-slate requests whenever the task can be partitioned without changing model semantics.

Required behavior:
- deterministic shards or date/range partitions;
- explicit per-call and per-job time bounds;
- durable persistence before advancing to the next work unit;
- idempotent and retry-safe operations;
- lease/claim/complete or equivalent contention protection for shared queues;
- acquisition, snapshotting, grading, calibration, and research separated when coupling creates timeout/recovery risk;
- resume from durable state after interruption rather than restarting completed work;
- fail closed on malformed, incomplete, or ambiguous work units;
- concurrency capped to observed provider/database/runtime limits;
- auditable run metadata for completed, failed, retried, leased, and pending units.

CI completion must not automatically fan out expensive sport workflows when an independent schedule already provides an equivalent bounded cadence. Post-deploy immediacy should be explicit and path-scoped rather than attached to every successful CI run.

This is an operational standard only. It does not change sport-specific model weights, gates, confidence calibration, qualification, or wager authority.

## 14. Cross-sport inheritance rule

A sport may inherit architecture and governance from this standard. It may **not inherit numeric thresholds, feature weights, variance assumptions, market tiers, or staking rules from another sport without sport-specific validation**.

The old CBB manual is therefore a structural ancestor, not a source of universal numeric rules.

## 15. Definition of done for a sport

A sport is "FBIS-standardized" only when:
- its manual contains all required sections;
- code paths referenced by the manual exist;
- temporal audit exists;
- independent/market separation is enforced;
- walk-forward validation exists;
- immutable snapshots and grading exist;
- qualification authority is explicit;
- production workflows and failure behavior are documented;
- model registry reflects actual state;
- known gaps are stated rather than filled by assumption.

