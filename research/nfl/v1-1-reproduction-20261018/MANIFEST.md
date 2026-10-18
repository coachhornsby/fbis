# NFL-PRO-v1.1 independent reproduction — 2026-10-18

## Dataset recovery
- Source: GitHub Actions artifact `nfl-game-training-2015-2026` from run `36968847766` (expires 2026-11-01)
- Local path (gitignored): `artifacts/nfl/nfl_game_training_2015_2026.csv`
- SHA-256: `6764647923489c6ec91e7996a11c05d44baca9f8d018181c924518385785ed07`
- Rows: 3077 training games (see walkforward REG in full CSV); walk-forward OOS REG sample n=2176
- Created UTC (artifact QA): 2026-10-02T05:28:51.742849+00:00
- Rebuild script: `scripts/build-nfl-training-dataset.py`
- No durable R2 training-CSV key found; CI artifact + rebuild script are the recovery paths

## Temporal integrity (from QA)
All rolling/expanding team and QB features use shift(1); current-game results are not used in pregame features.

## v1.1 reproduced metrics (scripts/nfl-pro-v1-1-walkforward.py)
| Metric | Archived reference | This run |
|---|---:|---:|
| Margin MAE | 10.1993 | 10.1993 |
| Total MAE | 10.6774 | 10.6774 |
| Winner accuracy | 64.338% | 64.338% |
| OOS REG games | 2,176 | 2176 |

## Settings
- Ridge alpha: 20.0
- Nested chronological blend selection: True
- Feature contract: 16 margin + 16 total (v1.1 compact EPA/QB core)
- Market used as benchmark only (never model input)

## Governance
Research reproduction only. No champion change. No wagering authority change.

wrote reproduction artifacts
