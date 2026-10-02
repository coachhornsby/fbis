# FBIS Continuous Learning Governance

FBIS continuous learning is self-governing, not self-modifying.

## Population

The learning population is the immutable `prediction_snapshots` ledger. The controller uses one latest valid pregame snapshot per game/model and excludes market-implied models from independent-model learning. Post-start snapshots and explicitly excluded rows do not enter training.

Executed bets remain evaluation evidence. They do not define the training population.

## Tier 1 — monitoring

Runs daily for MLB, NFL, CFB, CBB, NBA, WNBA, NHL, and soccer.

Tracks:
- Brier score
- log loss
- expected calibration error (ECE)
- margin MAE and bias
- total MAE and bias
- recent-vs-baseline drift

Drift alerts require minimum sample counts. No model parameters change.

## Tier 2 — recalibration

Recalibration is sample-count triggered, never calendar-triggered.

Default gate:
- minimum 160 binary settled observations
- after the first fit, at least 50 new settled observations before another fit
- chronological train/holdout split
- Platt scaling below 500 training rows
- beta calibration at 500+ training rows

The calibration fold is separate from the challenger holdout.

## Tier 3 — challenger gate

A recalibration challenger is evaluated on the identical chronological holdout used for its paired comparison.

Default promotion-readiness gate:
- at least 40 paired holdout rows
- Brier improvement of at least 0.001 with paired-bootstrap 95% CI entirely below zero, OR
- log-loss improvement of at least 0.002 with paired-bootstrap 95% CI entirely below zero
- ECE may not regress by more than 0.01
- operator approval remains mandatory

Passing this gate does not alter production or wager authority.

## Tier 4 — Bayesian shrinkage

FBIS maintains Normal-Normal posterior estimates for margin and total residual bias.

The posterior starts at zero bias and shrinks small samples toward zero. A state requires at least 60 settled observations. The recommended correction is advisory only and is never applied automatically.

## Tier 5 — online learning shadow

FBIS computes adaptive research weights from model log loss. These weights are persisted only in `online_learning_shadow`.

Hard controls:
- `production_enabled = 0`
- no wager authority
- no automatic model selection
- no automatic promotion

Tier 5 is telemetry for research. It cannot enter the real-money decision path.

## Persistence

Migration `0038_continuous_learning_governance` adds:
- `learning_monitor_runs`
- `recalibration_runs`
- `challenger_evaluations`
- `bayesian_learning_state`
- `online_learning_shadow`
- `model_promotion_decisions`
- `continuous_learning_meta`

## Scheduling

`.github/workflows/continuous-learning-governance.yml` runs once per day at 06:10 America/Chicago using twin UTC cron entries with a local-time gate.

The older weekly model-learning workflow now calls the same sample-gated controller rather than creating calendar-driven calibration challengers.

## Governance

Production rules are explicit:
- automatic promotion: disabled
- automatic wager authority: disabled
- tier-5 production use: disabled
- manual promotion approval: required

The purpose of the system is to collect evidence continuously and change models only when the predefined statistical gate is satisfied.
