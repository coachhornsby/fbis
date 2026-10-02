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
