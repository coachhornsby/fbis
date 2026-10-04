# NFL-PRO-v1.1 validation

Status: **RESEARCH EVIDENCE PASS** — not wager-authorized.

## Design
Compact regularized EPA/QB/opponent-adjusted core plus the independent calibrated scoring-form prior. Market lines are benchmark-only.

- Margin features: 16
- Total features: 16
- Ridge alpha: 20
- Nested chronological blend selection: yes
- Selected compact-PRO weight for the 2026 frozen fit: 0.60
- Form-prior weight: 0.40
- Fit used for prospective 2026 research is trained through 2025.

## True walk-forward evidence
Paired regular-season sample: 2,176 games, 2018 through current 2026.

| Metric | NFL-PRO-v1.1 | Calibrated form baseline | Closing market |
|---|---:|---:|---:|
| Margin MAE | 10.1993 | 10.3549 | 9.8543 |
| Total MAE | 10.6774 | 11.1791 | 10.4035 |
| Winner accuracy | 64.338% | 63.649% | 66.406% |

NFL-PRO-v1.1 improved on the calibrated form baseline by:
- 0.1556 points margin MAE
- 0.5017 points total MAE
- 0.689 percentage points winner accuracy

It does **not** beat the closing market aggregate benchmark.

## Governance
This satisfies the predeclared research comparison against the calibrated form baseline on all three aggregate metrics with n > 400. It does not authorize wagers, does not make the model a production champion, and does not justify using the closing line as a model input.

The 2026 sample is still small (49 games at validation time), so current-season prospective monitoring remains important. Runtime promotion also requires the production feature adapter to produce the exact compact pregame feature contract used here.


## NFL-PRO-v1.2 tracking/personnel rebuild

Status: **RESEARCH-ONLY RUNTIME CHALLENGER**.

The runtime challenger now accepts additional pregame-only evidence from nflverse/SportsDataverse-compatible public surfaces:

- Next Gen passing: CPOE, average time to throw, aggressiveness
- Next Gen rushing: rush yards over expectation per attempt, efficiency
- Next Gen receiving: average separation, YAC over expectation
- snap counts / snap share
- player-level tracking evidence for NFL player projections

The new signals are deliberately capped and additive. Missing tracking remains missing; it is not imputed into fake certainty. Sportsbook spreads, totals and PrizePicks lines remain excluded from projection inputs.

### Promotion rule

v1.2 is **not** promoted merely because it has richer features. It must earn promotion on leakage-safe chronological evidence. The next frozen historical comparison must report at minimum:

1. margin MAE
2. total MAE
3. winner accuracy
4. ATS result against archived pregame lines
5. totals result against archived pregame lines
6. calibration by projected-edge bucket
7. stability by season and by week

The existing v1.1 evidence remains the benchmark until a complete v1.2 historical feature table is built with as-of timestamps for NGS, snaps, depth/participation and availability. The production board may display v1.2 as research evidence, but wagering authorization remains fail-closed.

### Objective

The optimization target is not raw prediction accuracy alone. The system should identify a smaller set of stable, independently generated disagreements that retain value against the market out of sample. No claim of consistent market outperformance is made until the archived walk-forward evidence demonstrates it.
