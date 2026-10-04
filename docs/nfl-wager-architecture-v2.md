# NFL game-level wagering architecture v2

Status: **deployed only after CI + production verification; wagering remains fail-closed until confidence calibration is validated.**

## Objective

The wagering layer evaluates the individual offered wager, not a historical bucket.

```
Independent NFL projection
  -> explain model/market disagreement
  -> attach executable line + actual juice
  -> estimate cover/total probability
  -> calculate break-even probability and EV
  -> add point-in-time ACTION / market-intelligence context
  -> apply empirical confidence calibration
  -> BET/PASS
  -> stake only after staking validation
```

The independent NFL projection remains market-free. Sportsbook lines, ACTION public splits,
line movement, closing lines and PrizePicks lines are prohibited from NFL-PRO model features.

## Independent projection

NFL-PRO-v1.2 publishes:

- projected home and away score
- projected margin and total
- margin and total sigma
- QB contribution
- team efficiency / EPA contribution
- pass and rush matchup
- explosiveness
- pressure / pass protection
- trenches
- Next Gen tracking
- special teams
- context (rest/travel/weather/home field where available)
- injuries / availability as a bounded pregame adjustment

Missing evidence remains missing. Coverage increases uncertainty.

## Wager Intelligence

ACTION remains a separate market-intelligence source. Immutable observations are retained in
`action_market_book_observations`; snapshot pointers do not mutate prior observations.

Decision-time derivatives include:

- opening/current line
- line movement
- movement velocity
- persistence/reversal
- ticket %
- money %
- money-ticket divergence
- model/market confirmation or opposition
- FBIS edge expansion/decay

ACTION may reduce or contextualize confidence, but may not create a wager by itself.
Closing data is evaluation-only and is never included in pre-close decision features.

## Price and EV

Every offered side/total is evaluated at its actual American price.

- break-even probability derives from the actual price
- model probability derives from the independent distribution
- EV is expected profit per unit risk
- no default -110 assumption is permitted when actual juice is missing

Missing actual price => PASS.

## Confidence

`NFL-CONFIDENCE-v1` is fail-closed. The raw score is diagnostic only until the confidence
calibration artifact passes monotonicity and sample-size requirements.

A confidence mapping is valid only when:

1. it is fit on point-in-time historical/prospective decisions,
2. each published confidence bin has adequate sample size,
3. higher-confidence bins show non-decreasing realized win rate / EV,
4. the mapping remains stable prospectively.

Until then, `confidenceValidated=false` and the wager decision remains PASS even when raw EV is positive.

## Decision ledger

`nfl_wager_decisions` is append-only and stores each offered wager as evaluated at that moment:
line, price, probability, break-even probability, EV, uncertainty, confidence, decomposition and
market-intelligence packet.

`nfl_wager_outcomes` stores settlement and closing information separately. Closing values never
overwrite the original decision row.

## Validation priorities

Primary:

- units
- ROI
- probability calibration
- CLV
- max drawdown
- season stability
- confidence monotonicity

Diagnostics:

- margin MAE
- total MAE
- winner accuracy

Historical subsets are evidence/analogues only. They do not auto-generate wagers.

## Player props

NFL-PLAYER-PROJ-v3 remains independent of PrizePicks lines. It uses:

- weekly player production
- snap share / role confidence
- Next Gen passing/rushing/receiving
- team scoring environment
- opponent pass/rush/pressure matchup
- availability gating
- empirical dispersion when available

PrizePicks lines are comparison targets only. Weak role, missing dispersion or availability uncertainty
caps/blocks publication rather than being filled with fabricated certainty.
