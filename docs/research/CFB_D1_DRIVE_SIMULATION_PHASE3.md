# FBIS CFB Drive-State Simulator — Phase 3 prospective cohort

## Goal
After first live V2 research freeze succeeded on 2026-10-22 at 15:04:22Z for Alabama vs Texas A&M, expand a **pre-registered** research cohort from the existing CFB D1 without using hindsight, fabricated histories, new paid APIs, or changing model/wager authority.

## Immutable selection
The cohort file `data/research/cfb-drive-v2-cohort-20261022.tsv` contains 20 distinct events selected **in kickoff/game-ID order** from the next 20 eligible games with existing CFB-FBIS-v2 pregame baselines. Dates: Oct 22–24, 2026. No results or market spreads used to choose games. Existing Alabama pilot is separately included by the reporting endpoint.

## Freeze and provenance
`.github/workflows/cfb-v2-cohort-freeze-once-20261022.yml` fires **once**, after a successful main CI release with the exact `[CFB-V2-COHORT-20261022]` merge token. GitHub Actions already has the existing `HARVEST_SECRET`. Twenty sequential protected calls to `POST /api/cfb-simulation`, each `action=drive-research-asof`, `iterations=1000`. Does not call CFBD or other providers. Refuses calls after real kickoff (even when a queued runner is late); records exceptions instead of backfilling started games.

Each V2 run creates a unique `RESEARCH_ASOF` D1 receipt, preserving `sourceSnapshotFrozenAt` separately from the new `researchFrozenAt`. It uses only drives genuinely observed before the latter clock, in the existing `CFB_DB`, and is **not** comparable to a historical new-baseline forecaster in which the original model was rerun after drive ingestion. Subsequent audits must distinguish stale champion inputs from fresh simulation features.

## Calibration and grading
`.github/workflows/cfb-v2-cohort-grading.yml` is operator dispatchable; scheduled single-date execution for 2026-10-26 17:00Z (12 PM CT). It makes up to 20 protected `drive-grade` calls, **only** if the official game's regulation final is independently reconciled against CFBD's possession source. Failed/no-source events remain pending, not marked scored. This grading uses zero new CFBD calls; it depends on normal existing harvest arriving first.

`GET /api/cfb-simulation?mode=cohort` (authenticated) summarizes original CFB-FBIS-v2 baseline vs. V2 distributions using actual verified scores. Measures total and margin absolute error, V2 home/away absolute error, interval coverage at 80/90%, and explicitly counts ungraded games. Evaluation is descriptive; no conclusion of superiority/authorization until **at least 30 distinct prospective graded observations**. Thus a 20-game pilot alone **cannot** qualify or promote the model, regardless of how its scores compare.

## Limits
Regulation-only, no NCAA overtime, no player props, no validated probability calibration. All projection and wagering authority remains with the current production model. Existing research is a context-conditioned empirical drive outcome sampler rather than a full play-by-play model. No raw 1,000-draw paths are stored in D1. No one can retrospectively freeze after kickoff.
