# CFB-FBIS-v2 calibration / model-selection (2022–2025)

**Status:** experiment complete — **not promoted**. `canQualify: false` for CFB-FBIS-v2 and CFB-PLAYER-v1.

## Objective

Replace provisional A–K screening with **rolling-origin fitted** ridge models on the temporally valid provenance-eligible sample, without expanding features, loosening provenance, or promoting a shell replacement.

## 1. Eligible-sample selection bias

Source: `data/cfbd/calibration/coverage-selection-bias.json`

| Season | Snapshots | Pass | Rate |
|--------|-----------|------|------|
| 2022 | 3657 | 724 | **19.8%** |
| 2023 | 3591 | 1478 | 41.2% |
| 2024 | 3745 | 1545 | 41.3% |
| 2025 | 3743 | 1559 | 41.7% |
| **All** | **14736** | **5306** | **36.0%** |

**Why 2022 is low:** priors for 2022 games are the **2021** ratings freeze. CFBD 2021 SRS/SP+/FPI/Elo cover **FBS-only (~130)**. From 2022 onward SRS expands to **~261 (FBS+FCS)**. `buildPriorCatalog` unions `sp ∪ fpi ∪ srs ∪ elo ∪ core` only — **talent/recruiting keys are not unioned**. Missing prior catalog entries fail closed (`missing-source-provenance`). Dominant reject pattern: `both_prior_missing`.

**Matchup pass rates (approx):** FBS–FBS ≈ 99.7%; FBS–FCS / FCS–FCS higher in 2023–2025 when FCS SRS rows exist; D2/D3 ≈ 0%.

**Legitimate repair (not applied in this fit):** union `/talent` (optionally recruiting) school keys into the prior catalog with explicit `sourceSeason=priorYear`. Do **not** back-copy 2022 SRS onto 2021 or default missing `sourceSeason`.

**Implication:** fitting universe ≈ prior-catalog-complete games (near-all FBS–FBS). OOS metrics generalize to that universe, not full CFB/D2/D3.

## 2. A–K feature activation

Provisional (unfitted) identity audit: `data/cfbd/calibration/feature-activation-audit.json`  
Fitted nonzero rates: `data/cfbd/calibration/feature-activation-fitted.json`

| Finding | Classification |
|---------|----------------|
| **J ≡ K** | Architecturally identical masks/feature sets — not “no predictive value” |
| **D ≡ E** (havoc) | **Inactive in historical sample** (`havoc` nonzeroPct = 0) |
| **G / H** (finishing, qb) | **Inactive in historical sample** (nonzeroPct = 0) |
| Provisional **total MAE flat** | Mechanical: unfitted total ≈ `2 × nationalPpg` (margin cancels). Fitted path uses **intentional separate total ridge** |
| F, pace, context | Active in design matrix when present |

Identical provisional metrics ≠ evidence a block can never help — only that it contributed nothing under historical reconstruction.

## 3–6. Fitted rolling-origin protocol

Script: `scripts/cfb-v2-calibrate.mjs`  
Fit utils: `functions/lib/cfbFbisV2Fit.js`

Folds:

1. train 2022 → test 2023  
2. train 2022–2023 → test 2024  
3. train 2022–2024 → test 2025  

Per ablation: train-only impute/scale, λ tune on last train season (or 80/20 if single season), freeze before scoring. Separate **margin** and **total** ridge; `home/away = (total ± margin) / 2`.

Pooled OOS N = **4582** (eligible games in 2023–2025).

**Selected candidate: ablation A** (base only) — simplest within 0.05 maeMargin of best. **Not promoted.**

| Model | maeMargin | maeTotal | Brier |
|-------|-----------|----------|-------|
| Fitted A (selected) | 15.79 | 15.08 | 0.220 |
| Fitted B | 15.80 | 14.27 | 0.220 |
| Historical mean/HFA | 16.96 | 13.56 | 0.239 |
| Prior-strength (A-like) | 15.78 | 15.04 | 0.221 |
| Rolling off/def | 16.33 | 33.13 | 0.229 |
| FBIS-v1.4 shell ref | 15.88 | 13.53 | 0.222 |
| Book closing (**eval only**) | **12.25** | 14.81 | 0.169 |

**Bias convention:** `biasMargin = mean(predMargin − actualMargin)`; margin = home − away. Selected A bias ≈ **−1.68** (under-predicts home margin).

Paired season–week block bootstrap: A vs B ΔmaeMargin CI crosses 0 — no stable gain for complexity.

## 7–8. Selection & calibration

- Winner: **A** (simplest; statistically tied with more complex ablations on margin)  
- Calibration slope ≈ 0.98, intercept ≈ 0.03 on pooled OOS  
- 1σ interval coverage ≈ 0.66 (under-dispersed vs Normal ideal ~0.68; acceptable for research)

## 9. Blockers to replacing CFB shell

1. `canQualify: false` by policy  
2. Eligible universe selection-biased (prior-catalog-complete)  
3. Havoc / finishing / QB historically inactive — do not expand features yet  
4. Closing books still dominate margin MAE (eval-only; never fit input)  
5. No production shadow soak / wiring  
6. CORE throughWeek absent historically  

## 10–12. Artifacts / tests / SHA

| Artifact | Path |
|----------|------|
| Report | `data/cfbd/calibration/calibration-report.json` |
| Coefficients | `data/cfbd/calibration/fitted-coefficients.json` |
| Activation | `data/cfbd/calibration/feature-activation-fitted.json` |
| Coverage | `data/cfbd/calibration/coverage-selection-bias.json` |
| Hashes | `data/cfbd/calibration/calibration-hashes.json` |

```bash
CFB_CALIBRATE_SKIP_FETCH=1 node scripts/cfb-v2-calibrate.mjs
node --test test/cfb-fbis-v2-fit.test.js
```

Large design/OOS JSONL under `artifacts/` is gitignored; regenerate with API key when needed.
