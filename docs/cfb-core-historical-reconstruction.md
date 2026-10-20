# CFB CORE historical reconstruction & Model C readiness

Research-only. Champion **CFB-FBIS-v2 A/A**, PIT freezes, and wagering are unchanged.

## 1. Does CFBD provide authentic historical weekly CORE?

**Yes — with an honesty constraint.**

| Fact | Detail |
|------|--------|
| Endpoint | `GET /ratings/core?year=YYYY` |
| Coverage | 2016–present |
| Weekly field | `throughWeek` + `throughSeasonType` (+ `modelVersion`) |
| What is authentic | Distinct **stored** statistical endpoints per throughWeek |
| What is **not** claimed | Contemporaneous “as published that Tuesday” timestamps |

CFBD documents that historical CORE values are **retrospective recalculations** under the released methodology, not a ledger of what the model would have emitted live at that week. FBIS therefore:

1. Preserves **every distinct `throughWeek`** (never collapse to the requested collection week)
2. Labels archives `authenticityClass=retrospective_cfbd_stored` unless a live `collection_time` proves contemporaneous capture
3. Refuses promotion/wager claims that require contemporaneous publication times

Code: `functions/lib/cfbCoreHistorical.js` → `describeCfbdCoreHistoricalAvailability`, `partitionCoreRowsByThroughWeek`, `buildHistoricalCoreArchivePayloads`.

## 2. Jobs (research)

| Job | Behavior |
|-----|----------|
| `cfb-core-historical-reconstruct` | CFBD year fetch → archive each distinct throughWeek (skip already archived) |
| `cfb-core-publication-track` | Compare archived current throughWeek vs baseline (default 6); record genuine deltas + collection/publication timestamps |
| `cfb-core-model-c-readiness` | Gate Model C attempt on multi-season throughWeek depth + settled PIT rows |

Example (authorized Worker / college job runner):

```text
job=cfb-core-historical-reconstruct&season=2025
job=cfb-core-publication-track&season=2026&baselineThroughWeek=6
job=cfb-core-model-c-readiness
```

When a true Week-8 (or later) CORE publish appears in archive and differs from the Week-6 baseline, `cfb-core-publication-track` classifies `distinct_publish_with_rating_changes` and lists top team deltas. Identical label advances remain `label_advance_without_value_change` (as with the known W6→W7 duplicate).

## 3. Model C research readiness

Model **C** = Combined champion baseline features + CORE cross terms (`evaluateCfbCoreResearch`).

Fit is **blocked** until:

- ≥3 seasons each with ≥3 distinct archived throughWeeks
- ≥200 chronological PIT game rows (`throughWeek < gameWeek`, `coreSourceAsOf < kickoff`, verified finals)

When ready, `runModelCResearchIfReady` runs chronological walk-forward and compares against champion A/A baseline on:

- margin MAE
- winner accuracy
- totals MAE
- calibration (Brier)

Never auto-promotes; `canAuthorizeWager=0`, `canInfluenceProduction=0`.

## 4. Current live corpus (as of continuity audit)

| Season | Archived throughWeeks | Notes |
|--------|----------------------:|-------|
| 2026 | 6, 7 | W7 is value-identical to W6 (label duplicate) |
| 2025 / earlier | 0 in archive | Pending authorized historical reconstruct |

Next accumulation step: run `cfb-core-historical-reconstruct` for 2024–2025 (and early 2026 weeks once CFBD rows exist), then re-check Model C readiness. Do not force CORE into production.
