# CFB CORE historical reconstruction & Model C readiness

Research-only. Champion **CFB-FBIS-v2 A/A**, PIT freezes, and wagering are unchanged.

## Season policy (FBIS weekly training documents)

| Season | CORE research treatment |
|--------|-------------------------|
| 2024 and earlier | Do **not** assume equivalent weekly training documents exist |
| **2025** | First historical season — build the complete weekly sequence |
| **2026** | Second season — continue weekly snapshots + prospective validation |
| 2027 onward | Expand the longitudinal dataset |

**Immediate priorities:** reconstruct 2025 weekly CORE feature states, deduplicate `*updated*` documents, verify each report only includes data through its designated week (`throughWeek < schedule week`), and compare subsequent-game projections to champion A/A.

## Two datasets — keep distinct

| Source | Role |
|--------|------|
| FBIS weekly training documents (2025+) | Preserved weekly feature reports; first complete FBIS historical season is **2025** |
| CFBD `GET /ratings/core` | Stored weekly `throughWeek` rows (API coverage from 2016); **retrospective** recalculations |

Do **not** assume they share the same publication history. Label archives by source (`weekly_training_document` vs `retrospective_cfbd_stored`).

## Model C — evidence-based eligibility

Model **C** = Combined champion baseline + CORE cross terms (`evaluateCfbCoreResearch`).

**Not required:** a fixed three-season wait.

**Required (evidence-based):**

1. Verified historical cutoffs (`throughWeek < gameWeek` / schedule week)
2. Enough independent games (report **n** and uncertainty)
3. Valid chronological train/test separation (default: **train 2025 → evaluate 2026**)
4. Reproducible OOS evaluation path

Two seasons are enough to begin serious evaluation when those checks pass. Every report must include sample size and uncertainty — not an arbitrary season count.

Code: `assessModelCResearchReadiness` / `runModelCResearchIfReady` in `functions/lib/cfbCoreHistorical.js`.

## Jobs (research)

| Job | Behavior |
|-----|----------|
| `cfb-core-historical-reconstruct` | Optional CFBD year fetch → archive each distinct throughWeek (labeled retrospective) |
| `cfb-core-publication-track` | Compare archived current throughWeek vs baseline (default 6); deltas + timestamps |
| `cfb-core-model-c-readiness` | Evidence-based Model C gate (2025→2026); never auto-promote |

## Helpers

- `describeFbisCoreResearchSeasonPolicy()` — season treatment table
- `preferUpdatedWeeklyTrainingDocuments(files)` — dedupe preferring `*updated*`
- `verifyWeeklyReportCutoff({ weekField, claimedStatisticalThroughWeek })`

## Current live note

| Item | Status |
|------|--------|
| 2025 weekly training docs in TIER3_DB | Preferred corpus ingested (research_only) |
| 2026 CORE archive | throughWeek 6 (+ identical week-7 label) |
| Model C | Blocked until cutoffs verified + chronological PIT game vectors sized for 2025 train / 2026 test |

Do not force CORE into production.
