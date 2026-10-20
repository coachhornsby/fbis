# CFB CORE historical reconstruction & Model C readiness

Research-only. Champion **CFB-FBIS-v2 A/A**, PIT freezes, and wagering are unchanged until frozen-holdout evidence exists.

## Preferred evaluation design (locked)

| Season | Role |
|--------|------|
| **2025** | Training and model selection — construct valid weekly features, fit CORE coefficients, tune regularization, evaluate chronological splits **within 2025** |
| **2026** | Held-out evaluation — evaluate the **frozen** model on eligible 2026 games **without** using their results to refit parameters |

**Forbidden:** using 2026 for both tune and evaluate.

If historical data fail cutoff or coverage requirements, Model C stays **blocked** with an explicit reason.

Code: `functions/lib/cfbCoreHoldout.js` (`runCore2025Train2026HoldoutReport`, `evaluateFrozenModelCHoldout`).

## Season policy (FBIS weekly training documents)

| Season | CORE research treatment |
|--------|-------------------------|
| 2024 and earlier | Do **not** assume equivalent weekly training documents exist |
| **2025** | First historical season — build the complete weekly sequence (train foundation) |
| **2026** | Second season — continue weekly snapshots + **frozen** chronological holdout |
| 2027 onward | Expand the longitudinal dataset |

## Two datasets — keep distinct

| Source | Role |
|--------|------|
| FBIS weekly training documents (2025+) | **Primary** FBIS CORE research input — preserved weekly O/D EPA reports; first complete FBIS historical season is **2025** |
| CFBD `GET /ratings/core` | **Optional** external overlay — stored weekly `throughWeek` rows (API coverage from 2016); **retrospective** recalculations |

Do **not** assume they share the same publication history. Label archives by source (`weekly_training_document` vs `retrospective_cfbd_stored`).

### FBIS CORE from weekly reports (preferred research path)

A successful CFBD `/ratings/core` HTTP response alone does **not** define FBIS CORE methodology. Reconstruct team-strength features from weekly training CSVs:

| Report field | FBIS CORE mapping |
|--------------|-------------------|
| `adjusted_epa` | offense × 100 (per-100-play scale) |
| `adjusted_epa_allowed` | defense = −(allowed × 100) (CFBD-like sign) |
| schedule week `W` | archive `throughWeek = W − 1` |

Code: `functions/lib/cfbCoreFromWeeklyReports.js`. Offline runner:

```bash
CFB_HOLDOUT_TIER3_2025=/path/to/2025/csvs \
CFB_HOLDOUT_TIER3_2026=/path/to/2026/csvs \
CFB_HOLDOUT_GAMES=/path/to/scored-games.json \
node scripts/cfb-core-fbis-from-weekly-reports-holdout.mjs
```

CFBD is optional for CORE features; scored games + A/A (or SP→FBIS-v2) baselines are still required for the frozen holdout.

## Model C — evidence-based eligibility

Model **C** = Combined champion baseline + CORE cross terms.

**Not required:** a fixed three-season wait.

**Required:**

1. Verified historical cutoffs (`throughWeek < gameWeek`)
2. Enough independent games (report **n** and uncertainty)
3. Valid chronological train/test separation (**train 2025 → evaluate 2026**, frozen)
4. Champion A/A pregame baselines for head-to-head comparison
5. Reproducible OOS evaluation path

## Offline runner / Actions

```bash
# Requires CFBD_API_KEY; optional champion baselines JSON/JSONL
CFBD_API_KEY=… node scripts/cfb-core-2025-reconstruct-2026-holdout.mjs
```

GitHub Actions (`college.yml` / `cfb-core-2025-2026-holdout.yml`):

- Job: `cfb-core-2025-2026-holdout`
- Prefer repository secret `CFBD_API_KEY` for offline Actions CPU
- If that secret is empty: invoke Pages Worker `GET /api/college?job=cfb-core-2025-2026-holdout&trigger=workflow_dispatch&operatorApproved=true` (Pages production already has `CFBD_API_KEY` + `HARVEST_SECRET`)
- Optional artifact: `artifacts/cfb-champion-aa-baselines.json(l)` with `{gameId,baselineHome,baselineAway}`
- Uploads: `cfb-core-2025-2026-holdout` (report + archive snapshot)
- Pages binding `CFB_DB` (`fbis-cfb`) overlays live `prediction_snapshots` A/A when present

## Jobs (research Worker)

| Job | Behavior |
|-----|----------|
| `cfb-core-historical-reconstruct` | Optional CFBD year fetch → archive each distinct throughWeek (labeled retrospective) |
| `cfb-core-publication-track` | Compare archived current throughWeek vs baseline (default 6); deltas + timestamps |
| `cfb-core-model-c-readiness` | Evidence-based Model C gate (2025→2026); never auto-promote |
| `cfb-core-2025-2026-holdout` | Reconstruct 2025+2026 CORE, fit Model C on 2025, frozen 2026 holdout vs A/A (research-only) |

## Report fields

Every holdout report includes:

- Team coverage by season / throughWeek
- Eligible train (2025) and holdout (2026) game counts
- Validation error tallies (cutoff, coverage, missing A/A, missing finals)
- Fitted frozen coefficients (λ selected within 2025 only)
- Head-to-head winner accuracy vs champion A/A on 2026
- Explicit blockers when incomplete
- Production safeguards: A/A and wagering unchanged

## Current live note

| Item | Status |
|------|--------|
| 2025/2026 weekly training reports | Available (Tier3 CSVs / `TIER3_DB`) — **primary CORE input** |
| CFBD `/ratings/core` year reconstruct | Optional overlay; often incomplete for 2025 weekly throughWeeks |
| Champion A/A historical baselines | Prefer `prediction_snapshots`; SP→FBIS-v2 fallback for research |
| Model C research path | Fit 2025 / frozen 2026 holdout from weekly-report CORE (research-only) |

Do not force CORE into production.
