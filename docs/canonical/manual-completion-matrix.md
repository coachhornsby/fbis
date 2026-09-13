# FBIS Canonical Manual Completion Matrix

Governing manuals: Model Family Standard + CBB / CFB / NFL / NBA / MLB / NHL manuals.

Allowed statuses only: `IMPLEMENTED` · `IMPLEMENTED_RESEARCH_ONLY` · `VALIDATION_PENDING` · `OOS_DATA_PENDING` · `PROVIDER_OR_LICENSE_BLOCKED` · `OPERATOR_PROMOTION_REQUIRED`

## Shared architecture

| Manual / section | Requirement | Status | Modules / tests | Notes / blocker |
|---|---|---|---|---|
| Shared § decision authority | Misprice state machine + reason codes | IMPLEMENTED | `functions/lib/canonical/decisionAuthority.js`, `test/manual-completion-integrity.test.js` | Silent upgrades forbidden |
| Shared § probability | Probability provenance + authority | IMPLEMENTED | `probabilityAuthority.js` | Heuristic sigma ≠ calibrated EV |
| Shared § PURE firewall | Market/ACTION fields banned from PURE | IMPLEMENTED | `featureRegistry.js`, ACTION series firewall | Structural tests |
| Shared § registries | Source + model + feature registries | IMPLEMENTED | `sourceRegistry.js`, `modelRegistry.js`, `featureRegistry.js` | KenPom ≠ Torvik |
| Shared § PIT / projection | `effective_at ≤ cutoff < event_start` + projection contract | IMPLEMENTED | `lineageContract.js` | Leakage tests |
| Shared § DQ severity | INFO/WARNING/QUALIFICATION_BLOCK/MODEL_BLOCK | IMPLEMENTED | `dataQuality.js`, migration 0025 | Enforceable findings |
| Shared § publication ledger | Immutable publish + supersession | IMPLEMENTED | `publicationLedger.js`, migration 0025 | Separate from wager auth |
| Shared § promotion evidence | Walk-forward evidence loop; no auto-promote | IMPLEMENTED | `promotionEvidence.js` | Operator decision required |
| Shared § runtime version | Future stamp FBIS-v1.4; no history rewrite | IMPLEMENTED | `runtimeVersion.js`, `weights.MODEL_VERSION` | Historical stamps preserved |
| Shared § security | Harvest/write fail closed | IMPLEMENTED | `auth.js`, security tests | Missing secret ≠ allow |
| Shared § ACTION pipeline | Observations → snapshots → research derivatives | IMPLEMENTED | `actionObservationSeries.js`, `actionMarketDerivatives.js` | Firewalled from PURE/qualify/authorize |

## Sport programs

| Sport | Requirement | Status | Modules | Blocker / next evidence |
|---|---|---|---|---|
| CFB | Preserve CFB-FBIS-v2 champion | IMPLEMENTED | model registry + freeze guard | Do not mutate coefficients |
| CFB | Challenger feature slots + prior provenance | IMPLEMENTED_RESEARCH_ONLY | `cfbChallengerScaffold.js` | Ablation + OOS before promotion |
| CBB | Market-implied cannot qualify | IMPLEMENTED | slate integrity + decision authority | UI may show MARKET BENCHMARK |
| CBB | PURE possessions×PPP challenger | IMPLEMENTED_RESEARCH_ONLY / OOS_DATA_PENDING | `cbbPureChallenger.js` | Walk-forward OOS N not yet accumulated |
| NFL | No production PURE champion | IMPLEMENTED | board NO_MODEL + market baseline | Honest research stance |
| NFL | NFL-FBIS-PURE research challenger | IMPLEMENTED_RESEARCH_ONLY / OOS_DATA_PENDING | `nflPureChallenger.js` | Graded OOS pending |
| NBA | Market-implied cannot qualify | IMPLEMENTED | integrity + NBA architecture | — |
| NBA | Player-driven research architecture | PROVIDER_OR_LICENSE_BLOCKED | `nbaResearchArchitecture.js` | Rights-cleared production feed missing |
| MLB | Preserve Savant RPG×SP champion | IMPLEMENTED | model registry | — |
| MLB | Challengers (park/bullpen/lineup/…) | IMPLEMENTED_RESEARCH_ONLY / VALIDATION_PENDING | `mlbChallengerScaffold.js` | Temporal validation before promote |
| NHL | Research contracts + goalie-first props | PROVIDER_OR_LICENSE_BLOCKED | `nhlResearchArchitecture.js` | Commercial NHL feed agreement missing |

## Probability / misprice authority map

| Claim | Allowed when | Otherwise |
|---|---|---|
| FBIS fair probability / odds / EV | Validated distribution + calibrator + OOS + calibrated source | MODEL_DISAGREEMENT / projection+line only |
| QUALIFIED | Independent FBIS projection + integrity + two-way market + authority | BLOCKED / NO_MODEL |
| AUTHORIZED | QUALIFIED + operator/human gate | Never from ACTION or market-implied |
| EXECUTED | Manual human confirmation | Never auto |

## Remaining non-IMPLEMENTED items (legitimate only)

1. **CBB PURE / NFL PURE OOS** — machinery ready; future graded observations required → `OOS_DATA_PENDING`
2. **NBA / NHL production ingestion** — architecture ready; licensed machine-readable feed unavailable → `PROVIDER_OR_LICENSE_BLOCKED` (`nba_stats_licensed`, `nhl_stats_licensed`)
3. **Any challenger → production champion** — evidence + explicit operator approval required → `OPERATOR_PROMOTION_REQUIRED`
4. **CFB feature ablations / MLB challenger OOS** — scaffolds present; validation evidence pending → `VALIDATION_PENDING` / `OOS_DATA_PENDING`

What specifically prevents completing those today: missing future OOS sample paths, missing commercial provider rights, or required human promotion — not “would take more work.”
