# CFB Game-Level Wager Intelligence v1

Decision unit: the individual offered wager. Historical subsets are features/diagnostics, never standalone betting rules.

Pipeline: independent projection -> factor decomposition -> immutable market/ACTION trajectory -> calibrated probability -> actual-price break-even -> EV -> confidence -> BET/PASS.

The independent projection remains market-free. ACTION is execution-only. Persist OPEN/daily/T-24/T-12/T-6/T-3/T-1/final-pregame/close when available; never backfill a missing earlier observation with later information. Close is evaluation-only for CLV.

Validation is point-in-time walk-forward. Primary wagering metrics: units, ROI, calibration, CLV, drawdown, season stability and confidence monotonicity. No outcome-driven subgroup rule may authorize a wager.
