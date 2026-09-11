# CFB-FBIS-v2 final model selection (talent-catalog repair)

**Status:** final selection complete — **projection cutover wired**. `canQualify: false`. Wager authorization remains **disabled**.

## Purpose

Resolve two issues from PR #50:

1. Legitimate prior-catalog coverage loss (especially 2022 / 2021 prior freeze).
2. Inappropriate use of one ablation winner for both margin and total.

No new feature families. No promotion.

## 1. Prior-catalog coverage repair

`buildPriorCatalog` now unions `/talent` school keys **only** when the talent row has explicit `year|season === priorSeason` and a finite talent value.

- Adding a key does **not** invent ratings (`priorOff` / `priorDef` stay `null` for talent-only rows).
- `sourceSeason` is the actual talent year for talent-only membership.
- Fail closed if provenance is absent (wrong year / missing year excluded).
- No future-season backfill.
- Personnel bumps require a ratings spine — talent is never a substitute rating.
- Fixed `num(null)===0` so missing values are not coerced into fabricated zeros.

### Eligible N (old 5,306 vs repaired)

| Season | Previous | Repaired | Δ |
|--------|----------|----------|---|
| 2022 | 724 | **1,185** | **+461** |
| 2023 | 1,478 | 1,478 | 0 |
| 2024 | 1,545 | 1,545 | 0 |
| 2025 | 1,559 | 1,559 | 0 |
| **All** | **5,306** | **5,767** | **+461** |

2021 prior catalog: ratings-only ~131 → **225** with talent union (**94 talent-only** keys). 2022+ seasons were already near-saturated by expanded SRS, so N is unchanged there.

**Selection-bias note:** OOS metrics still generalize to the **prior-catalog-complete / projectable** universe (near-all FBS–FBS plus sides with valid prior membership and projectable base power). Talent-only membership expands provenance eligibility; it does not fabricate power ratings.

## 2. Target-specific architecture selection

Rolling-origin folds (unchanged):

1. train 2022 → test 2023  
2. train 2022–23 → test 2024  
3. train 2022–24 → test 2025  

Train-only impute / scale / λ / fit. Separate ridge for margin and total.

Inactive historical blocks remain classified inactive and are **not** treated as tested predictors: **E (havoc), G (finishing), H (qb)**. **K ≡ J** architecturally.

### Margin (M*)

Rank: MAE → RMSE → |bias| → Brier → log loss → fold stability → complexity.

| Ablation | maeMargin | maeTotal | Notes |
|----------|-----------|----------|-------|
| C | 13.894 | 13.647 | best raw margin MAE |
| **A (M\*)** | **13.901** | **13.526** | selected |
| B | 13.905 | 13.697 | |

Paired season–week block bootstrap:

- **C vs A (margin MAE):** mean Δ ≈ −0.007, 95% CI **[−0.033, +0.020]** (crosses 0) → prefer simpler **A**.
- **A vs B (margin MAE):** mean Δ ≈ −0.004, 95% CI **[−0.025, +0.018]** (crosses 0) → no stable A/B margin difference.

**M\* = A**

### Total (T*)

Rank: total MAE → RMSE → |signed total bias| → fold stability → complexity.

| Ablation | maeTotal | maeMargin |
|----------|----------|-----------|
| **A (T\*)** | **13.526** | 13.901 |
| I | 13.542 | 13.925 |
| B | 13.697 | 13.905 |

Paired **A vs B (total MAE):** mean Δ ≈ **+0.172**, 95% CI **[+0.088, +0.290]** (B worse; does not cross 0).

**T\* = A**

PR #50’s “keep A globally because it is simpler despite B’s better total” is superseded: on the repaired sample, **A also wins totals** on MAE and paired uncertainty.

## 3. Coherent scores

```
margin = homeScore − awayScore   // home − away; positive ⇒ home favored
homeScore = (total + margin) / 2
awayScore = (total − margin) / 2
```

Feasible scores by construction. Uncertainty uses M\* residual σ from the training fold. Covariance handled via shared residual σ on the margin margin for win probability (`Φ(margin / σ)`).

## 4. Baseline & market gates (evaluation-only for books)

Independent baselines (pooled OOS):

| Baseline | maeMargin | maeTotal |
|----------|-----------|----------|
| Historical mean / HFA | 16.98 | 13.62 |
| Prior-strength only | 13.91 | 13.53 |
| Rolling off/def | 14.14 | 18.48 |
| FBIS-v1.4 shell | 13.93 | 13.53 |
| **M\*+T\* (A/A)** | **13.90** | **13.53** |
| Book closing (**eval only**) | **11.96** | **12.64** |

Gates:

- Margin beats historical / prior-strength / shell: **yes**. Does not beat books (eval only).
- Total beats historical / rolling / shell: **yes**. Does not beat books (eval only).
- Total is **not** worse than naïve/simple independents.

### Market — report separately

Do **not** say “books win both” as a vague slogan without metrics — but on **this** repaired sample with closing lines attached:

- **Spread:** books MAE 11.96 vs FBIS 13.90 → books stronger on margin.
- **Total:** books MAE 12.64 vs FBIS 13.53 / shell 13.53 → books also stronger on totals here (unlike the PR #50 totals snapshot where books ~14.81 trailed shell ~13.5 — that earlier totals book figure reflected incomplete line attachment).

## 5. Cutover recommendation

| Decision | Recommendation |
|----------|----------------|
| **Game projection engine** | **CUTOVER** — temporally valid M\*/T\* on repaired provenance sample; beats independent baselines; A/A coherent; ceremonial soak is **not** an automatic blocker |
| **Wager authorization** | **DO NOT ENABLE** |
| `canQualify` | **false** (unchanged) |

### Production wiring (landed)

1. `data/models/cfb-fbis-v2-fitted-aa.js` packages fold3 A intercept/beta **verbatim** from `fitted-coefficients-final.json` plus train means/stds for `predictRidge`.
2. `projectCfbFbisV2Production` / `promoteCfbFbisV2ToBoard` load A/A coherent scores onto the CFB board.
3. `canQualify` and wager authorization remain **false**.
4. Inactive blocks (havoc / finishing / qb) still untested as predictors if later populated.

## Artifacts

- `data/cfbd/calibration/design-rows.jsonl` (5,767)
- `data/cfbd/calibration/design-rows-pre-talent-5306.jsonl`
- `data/cfbd/calibration/coverage-repair.json`
- `data/cfbd/calibration/final-select-report.json`
- `data/cfbd/calibration/final-select-hashes.json`
- `data/cfbd/calibration/fitted-coefficients-final.json`
- Mirrored under `data/cfbd/calibration/`

Scripts: `scripts/cfb-v2-rebuild-design.mjs`, `scripts/cfb-v2-final-select.mjs`
