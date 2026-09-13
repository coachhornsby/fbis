# FBIS Canonical Manual Completion Matrix

Governing manuals: Model Family Standard + CBB / CFB / NFL / NBA / MLB / NHL manuals.

**Allowed statuses only:** `IMPLEMENTED` · `IMPLEMENTED_RESEARCH_ONLY` · `IMPLEMENTED_SCAFFOLD` · `IMPLEMENTATION_PENDING` · `VALIDATION_PENDING` · `OOS_DATA_PENDING` · `PROVIDER_OR_LICENSE_BLOCKED` · `OPERATOR_PROMOTION_REQUIRED`

**Governing rule for `OOS_DATA_PENDING`:** Allowed only when the data adapter, feature computation, model execution, immutable shadow freeze, grading path, and walk-forward runner already exist — and the sole missing dependency is future graded observations. Declared feature-name arrays, status objects, or wrappers around older shadows do **not** qualify.

---

## Shared architecture

| Manual | Section | Requirement | Status | Adapter | Persistence | Module | Test | Maturity | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| Shared | decision authority | Misprice state machine + reason codes | IMPLEMENTED | n/a | n/a | `functions/lib/canonical/decisionAuthority.js` | `test/manual-completion-integrity.test.js` | production | — |
| Shared | probability | Provenance + authority; heuristic ≠ calibrated EV | IMPLEMENTED | n/a | n/a | `probabilityAuthority.js` | integrity | production | — |
| Shared | PURE firewall | Market/ACTION fields banned from PURE | IMPLEMENTED | n/a | n/a | `featureRegistry.js` + ACTION firewall | integrity | production | — |
| Shared | registries | Source + model + feature registries | IMPLEMENTED | n/a | n/a | `sourceRegistry.js`, `modelRegistry.js`, `featureRegistry.js` | canonical governance | production | — |
| Shared | PIT / projection | `effective_at ≤ cutoff < event_start` + contract | IMPLEMENTED | n/a | n/a | `lineageContract.js` | integrity | production | — |
| Shared | DQ severity | INFO/WARNING/QUALIFICATION_BLOCK/MODEL_BLOCK | IMPLEMENTED | n/a | D1 `canonical_dq_findings` | `dataQuality.js` + migration 0025 | migration contract | production | — |
| Shared | publication ledger | Immutable publish + supersession | IMPLEMENTED | n/a | D1 publication ledger | `publicationLedger.js` | integrity | production | — |
| Shared | promotion evidence | Walk-forward evidence; no auto-promote | IMPLEMENTED | n/a | D1 promotion evidence | `promotionEvidence.js` | integrity | production | — |
| Shared | runtime version | Future stamp FBIS-v1.4; no history rewrite | IMPLEMENTED | n/a | n/a | `runtimeVersion.js`, `weights.MODEL_VERSION` | integrity | production | — |
| Shared | security | Harvest/write fail closed | IMPLEMENTED | n/a | n/a | `auth.js` | security + integrity | production | — |
| Shared | ACTION pipeline | Append-only obs → snapshots → research derivatives | IMPLEMENTED | Apify ACTION shadow | D1 0024 series tables | `actionObservationSeries.js`, `actionMarketDerivatives.js` | `test/action-observation-series.test.js`, `test/functional-pipeline.test.js` | research/shadow | Rights unresolved; firewalled |

---

## NFL (requirement-level)

| Manual | Section | Requirement | Status | Adapter | Persistence | Module | Test | Maturity | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| NFL | board honesty | No production PURE champion | IMPLEMENTED | n/a | n/a | board NO_MODEL + market baseline | board tests | production | — |
| NFL | PBP normalize | nflfastR/nflverse-shaped → canonical plays | IMPLEMENTED_RESEARCH_ONLY | caller-supplied / nflverse-shaped rows | optional D1 raw (not required for research path) | `nflPbpNormalize.js` | `functional-pipeline` | research | Production archival job wiring pending |
| NFL | PIT filter | Cutoff excludes future plays | IMPLEMENTED_RESEARCH_ONLY | n/a | n/a | `filterPlaysByInformationCutoff` | functional-pipeline | research | — |
| NFL | feature: historical_pbp | Computed presence flag from PIT window | IMPLEMENTED_RESEARCH_ONLY | PBP normalize | feature snapshot object | `nflPbpFeatures.js` | functional-pipeline | research | — |
| NFL | feature: epa | Team EPA means + matchup diff | IMPLEMENTED_RESEARCH_ONLY | PBP `epa` field | feature snapshot | `nflPbpFeatures.js` | functional-pipeline | research | Requires source EPA; not invented |
| NFL | feature: success_rate | Success rate + diff | IMPLEMENTED_RESEARCH_ONLY | PBP `success` | feature snapshot | `nflPbpFeatures.js` | functional-pipeline | research | — |
| NFL | feature: early_down_efficiency | Early-down success | IMPLEMENTED_RESEARCH_ONLY | PBP downs | feature snapshot | `nflPbpFeatures.js` | functional-pipeline | research | — |
| NFL | feature: passing_down_efficiency | Passing-down success | IMPLEMENTED_RESEARCH_ONLY | PBP downs | feature snapshot | `nflPbpFeatures.js` | functional-pipeline | research | — |
| NFL | feature: rush_pass_splits | Rush/pass rates | IMPLEMENTED_RESEARCH_ONLY | PBP play type | feature snapshot | `nflPbpFeatures.js` | functional-pipeline | research | — |
| NFL | feature: explosiveness | Explosive play rate | IMPLEMENTED_RESEARCH_ONLY | yards threshold | feature snapshot | `nflPbpFeatures.js` | functional-pipeline | research | — |
| NFL | feature: pressure_sacks | Sack rate proxy | IMPLEMENTED_RESEARCH_ONLY | PBP sack | feature snapshot | `nflPbpFeatures.js` | functional-pipeline | research | Pressure ≠ sack; incomplete |
| NFL | feature: turnovers_regression | Turnover rates | IMPLEMENTED_RESEARCH_ONLY | INT/fumble | feature snapshot | `nflPbpFeatures.js` | functional-pipeline | research | Regression-to-mean model pending |
| NFL | feature: red_zone | RZ success | IMPLEMENTED_RESEARCH_ONLY | yardline | feature snapshot | `nflPbpFeatures.js` | functional-pipeline | research | — |
| NFL | feature: pace | Plays/game | IMPLEMENTED_RESEARCH_ONLY | play counts | feature snapshot | `nflPbpFeatures.js` | functional-pipeline | research | — |
| NFL | feature: field_position | Declared only | IMPLEMENTATION_PENDING | — | — | — | — | none | No adapter/transform/consumption |
| NFL | feature: special_teams | Declared only | IMPLEMENTATION_PENDING | — | — | — | — | none | — |
| NFL | feature: rosters | Declared only | IMPLEMENTATION_PENDING | — | — | — | — | none | — |
| NFL | feature: qb_identity_value | Declared only | IMPLEMENTATION_PENDING | — | — | — | — | none | — |
| NFL | feature: injuries_practice_status | Declared only | IMPLEMENTATION_PENDING | — | — | — | — | none | Dead nflverse dumps ≠ 2026 truth |
| NFL | feature: active_inactive | Declared only | IMPLEMENTATION_PENDING | — | — | — | — | none | — |
| NFL | feature: coaching_context | Declared only | IMPLEMENTATION_PENDING | — | — | — | — | none | — |
| NFL | feature: venue_roof_surface | Declared only | IMPLEMENTATION_PENDING | — | — | — | — | none | — |
| NFL | feature: weather | Declared only | IMPLEMENTATION_PENDING | — | — | — | — | none | — |
| NFL | feature: rest_travel | Declared only | IMPLEMENTATION_PENDING | — | — | — | — | none | — |
| NFL | research model | Transparent OLS margin from computed features | IMPLEMENTED_RESEARCH_ONLY | fitted on historical folds only | in-memory fit artifact | `nflResearchPipeline.js` | functional-pipeline | research | No fabricated coefficients |
| NFL | walk-forward runner | Expanding walk-forward on labeled rows | IMPLEMENTED_RESEARCH_ONLY | n/a | frozen+graded arrays | `runNflWalkForward` | functional-pipeline | research | Production job auto-run pending |
| NFL | immutable freeze | Research projection freeze contract | IMPLEMENTED_RESEARCH_ONLY | n/a | in-memory / optional collegeStore | `freezeNflResearchProjection` | functional-pipeline | research | Production job auto-freeze = false |
| NFL | grading | Final score → graded shadow | IMPLEMENTED_RESEARCH_ONLY | n/a | grade object | `gradeNflResearchProjection` | functional-pipeline | research | Production job auto-grade = false |
| NFL | form fallback wrapper | Team-form shadow when PBP path absent | IMPLEMENTED_SCAFFOLD | team PPG form | n/a | `nflModel.js` via `nflPureChallenger.js` | nfl-model + integrity | scaffold | **Not** the manual pure model |
| NFL | production OOS N | Future graded observations after full path | VALIDATION_PENDING | — | — | walk-forward machinery exists | functional-pipeline | research | Historical replay possible now; production OOS accumulation + operator promotion remain — **not** sole `OOS_DATA_PENDING` while non-PBP features / auto-freeze-grade unfinished |

---

## CBB

| Manual | Section | Requirement | Status | Adapter | Persistence | Module | Test | Maturity | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| CBB | market-implied gate | Cannot qualify | IMPLEMENTED | n/a | n/a | decision/slate integrity | integrity | production | — |
| CBB | possessions×PPP baseline | Minimal independent research challenger | IMPLEMENTED_RESEARCH_ONLY | adj OE/DE/tempo inputs | projection contract | `cbbPureChallenger.js` | integrity + functional | research | Not full manual |
| CBB | CBBD adapter + archival | Ratings fetch/archive | IMPLEMENTED | CBBD | college store + R2 | `collegeApi` / `cbbRatings` | college tests | shared | — |
| CBB | KenPom API adapter | Source adapter | IMPLEMENTATION_PENDING | — | — | `kenpomAbsent` stub | — | none | No client |
| CBB | Torvik bulk adapter | Source adapter | IMPLEMENTATION_PENDING | — | — | stub | — | none | No ingest |
| CBB | PIT ratings snapshots | Source-specific PIT store | IMPLEMENTED_SCAFFOLD | shared PIT helper | freeze cutoff | `lineageContract` | integrity | scaffold | No dedicated CBB PIT ratings store |
| CBB | source lineage KenPom≠Torvik≠CBBD | Registry declarations | IMPLEMENTED_SCAFFOLD | registry | — | `sourceRegistry` | governance | scaffold | Live KenPom/Torvik missing |
| CBB | possession/efficiency registry | Feature registry entries | IMPLEMENTED_SCAFFOLD | registry | — | `featureRegistry` | — | scaffold | Labels without live adapters |
| CBB | richer matchup features | Beyond OE/DE/tempo | IMPLEMENTATION_PENDING | — | — | — | — | none | — |
| CBB | expected-minutes / opportunity | Player opportunity architecture | IMPLEMENTATION_PENDING | — | — | — | — | none | NBA helper only |
| CBB | player-stat models | Player projections | IMPLEMENTATION_PENDING | — | — | — | — | none | — |
| CBB | training artifacts | PURE fitted artifact | IMPLEMENTED_SCAFFOLD | schema | `data/models/cbb-reg-v1.js` | artifact schema | — | scaffold | No distinct PURE fit artifact |
| CBB | walk-forward runner | College jobs temporal folds | IMPLEMENTED | n/a | validation runs | `collegeJobs` | research-validation | shared | PURE series thin |
| CBB | frozen challenger preds | Freeze path | IMPLEMENTED | n/a | model_predictions | `collegeJobsCore` | college/model-lab | shared | — |
| CBB | grading | Grade frozen preds | IMPLEMENTED | n/a | D1 | `gradeScores` | model-lab | shared | — |
| CBB | baseline comparison | Model lab metrics | IMPLEMENTED | n/a | n/a | `modelLab` | model-lab | shared | — |
| CBB | Pinnacle paired-error | Paired comparison | IMPLEMENTED | n/a | n/a | `pairedModelComparison` | model-lab | shared | PURE v0 series thin |

---

## CFB / MLB / NBA / NHL

| Manual | Section | Requirement | Status | Adapter | Persistence | Module | Test | Maturity | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| CFB | champion freeze | Preserve CFB-FBIS-v2 | IMPLEMENTED | n/a | fitted artifact | model registry + freeze guard | integrity | production | Do not mutate |
| CFB | champion feature pipeline | Real CFB feature path | IMPLEMENTED | CFBD etc. | feature store | `cfbFeaturePipeline.js` | cfb-feature-pipeline | production/research | Separate from challenger scaffolds |
| CFB | challenger feature slots | Declared slots only | IMPLEMENTED_SCAFFOLD | — | — | `cfbChallengerScaffold.js` | integrity | scaffold | Each slot `IMPLEMENTATION_PENDING` pipeline |
| CFB | prior provenance | Live ≠ preseason labeling | IMPLEMENTED | n/a | provenance object | `buildCfbPriorProvenance` | integrity | production | — |
| MLB | champion freeze | Preserve Savant RPG×SP | IMPLEMENTED | n/a | savant module | model registry | integrity | production | — |
| MLB | starter/lineup uncertainty helper | Sigma / suppress fragile | IMPLEMENTED_SCAFFOLD | enums | n/a | `mlbContextUncertainty` | integrity | scaffold | Not full challenger pipelines |
| MLB | challengers (park/bullpen/…) | Declared slots | IMPLEMENTED_SCAFFOLD / IMPLEMENTATION_PENDING | — | — | `mlbChallengerScaffold.js` | integrity | scaffold | No provider→grade path |
| NBA | market-implied gate | Cannot qualify | IMPLEMENTED | n/a | n/a | `nbaMarketImpliedCannotQualify` | integrity | production | — |
| NBA | production stats ingestion | Licensed feed | PROVIDER_OR_LICENSE_BLOCKED | — | — | status object | integrity | blocked | Rights-cleared feed |
| NBA | opportunity contract / enums / prop list | Provider-independent | IMPLEMENTED / IMPLEMENTED_SCAFFOLD | caller inputs | n/a | `nbaResearchArchitecture.js` | integrity | scaffold | — |
| NBA | score distribution / PPP / covariance / freeze-grade | Provider-independent models | IMPLEMENTATION_PENDING | — | — | — | — | none | Not excused by license block |
| NHL | production ingestion | Licensed feed | PROVIDER_OR_LICENSE_BLOCKED | — | — | status object | integrity | blocked | Commercial agreement |
| NHL | goalie enum / opportunity / markets | Provider-independent | IMPLEMENTED / IMPLEMENTED_SCAFFOLD | caller inputs | n/a | `nhlResearchArchitecture.js` | integrity | scaffold | — |
| NHL | xG / ST / freeze-grade / calibrator | Provider-independent models | IMPLEMENTATION_PENDING | — | — | — | — | none | Not excused by license block |

---

## Probability / misprice authority map

| Claim | Allowed when | Otherwise |
|---|---|---|
| FBIS fair probability / odds / EV | Validated distribution + calibrator + OOS + calibrated source | MODEL_DISAGREEMENT / projection+line only |
| QUALIFIED | Independent FBIS projection + integrity + two-way market + authority | BLOCKED / NO_MODEL |
| AUTHORIZED | QUALIFIED + operator/human gate | Never from ACTION or market-implied |
| EXECUTED | Manual human confirmation | Never auto |

---

## Remaining blockers (honest)

1. **NFL non-PBP feature families** — IMPLEMENTATION_PENDING (not OOS).
2. **NFL production auto-freeze/grade wiring** — IMPLEMENTATION_PENDING (research freeze/grade exist).
3. **CBB KenPom/Torvik/minutes/player models / richer matchups** — IMPLEMENTATION_PENDING.
4. **CFB/MLB challenger pipelines** — IMPLEMENTED_SCAFFOLD / IMPLEMENTATION_PENDING (champions locked).
5. **NBA/NHL ingestion** — PROVIDER_OR_LICENSE_BLOCKED; **models/grade/publication** still IMPLEMENTATION_PENDING where unfinished.
6. **Any challenger → champion** — OPERATOR_PROMOTION_REQUIRED after evidence.
7. **True `OOS_DATA_PENDING`** — only after a sport’s full pipeline exists and only future graded N remains. **Do not use that label for NFL/CBB program completion today.**
