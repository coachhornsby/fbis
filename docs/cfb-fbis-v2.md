# CFB-FBIS-v2 + CFBD endpoint audit

Independent College Football challenger built on CFBD. **Shadow only** — does not replace the production champion until Model Lab promotion gates pass and an operator approves.

## Hard rules

1. No leakage (post-kickoff data never enters a pregame vector)
2. No market data in the independent FBIS score
3. No automatic promotion (`canQualify: false`)
4. Champion remains intact during development
5. Adapt to what CFBD actually returns — do not invent metrics

## Live audit

- College job: `/api/college?job=cfbd-endpoint-audit`
- Post-deploy CI step on `main` uploads `cfbd-endpoint-audit-<sha>` artifact + job summary table
- Manual: Actions → FBIS college research → `cfbd-endpoint-audit`

## Feature pipeline

`functions/lib/cfbFeaturePipeline.js` + offline `scripts/cfb-feature-backfill.mjs`:

- Prior = **prior-season** SP+/FPI/SRS/Elo/talent/returning freeze (temporal class A)
- Matchup = rolling reconstruction from `/ppa/games` + `/stats/game/advanced` before kickoff (class C)
- Season aggregates (`/ppa/teams`, `/stats/season/advanced`) are **not** used naïvely in historical backtests
- Market lines under `features.evaluation` only
- FCS: team SRS/Elo → conference mean → provisional if missing

## Offline backfill

College workflow job `cfb-feature-backfill` (requires GitHub secret `CFBD_API_KEY`):

```
seasons=2022,2023,2024,2025
```

Writes ablation A–K metrics + fold chronology under `artifacts/`.

## Calibration / model selection (fitted)

See `docs/cfb-v2-calibration.md`. Rolling-origin ridge fits on provenance-eligible 2022–2025 games select **ablation A** (simplest; within 0.05 maeMargin of best). **Not promoted** — `canQualify` stays false.

```bash
CFB_CALIBRATE_SKIP_FETCH=1 node scripts/cfb-v2-calibrate.mjs
```

## Model

Layers: prior → rolling `n/(n+k)` → matchup → QB residual → context (HFA 2.5) → score.
Ablations A–K. Uncertainty LOW/MEDIUM/HIGH. Shadow `canQualify: false`.

## Prior decay (production)

Current-season primacy uses `blendPriorCurrent(prior, current, gamesPlayed, k=6)`:

```
w = n / (n + 6)
blended = (1 - w) * prior + w * current
```

- `n` is completed-game count when available; otherwise week-bounded `coreThroughWeek` from persisted `team_feature_snapshots`.
- By Week 7 (`n ≈ 6`), current weight is ≥ 50% — prior no longer dominates when current PPA/form exists.
- SP `off`/`def` ratings inside snapshots are **not** current PPG and must not replace PPA-derived current strength.
- If current-season inputs are genuinely missing, projections are marked provisional (`prior_only` / missing-current signals) rather than silently confident prior scores.
- Alternate `k` values may be evaluated research-only (`functions/lib/cfbPriorDecay.js`); production `k=6` is not retuned from a single slate.

Live deep feed order (daytime / cache-only): D1 `team_feature_snapshots` → warmed Workers cache → explicit miss. Never spend CFBD quota on a miss.

## Promotion

Uses existing `PROMOTION_CRITERIA` exactly. No auto flip.
