# NHL game- and player-level wagering architecture v1

Status: research evidence collection. Wager authority and staking remain fail-closed until prospective validation clears governance.

## Objective

```
Independent NHL projection
  -> explain model/market disagreement
  -> attach offered line + actual price
  -> estimate market-specific probability
  -> calculate break-even probability and EV
  -> add immutable odds/ACTION trajectory as wager intelligence
  -> apply empirically validated confidence calibration
  -> BET/PASS
  -> stake only after staking validation
```

NHL-PRO and NHL-PLAYER remain market-free. Sportsbook prices, public splits, line movement and closing information are prohibited projection inputs.

## Hockey-specific disagreement

Game decision packets expose xG/event-chain strength, goalie value, finishing, special teams, rest/form, team EDGE pressure and player EDGE advisory differentials. Tracking data that has not cleared prospective validation is labeled advisory and may affect reliability analysis, not the independent score.

## Deployment and scratches

The equal scratch-TOI redistribution challenger was rejected after three-season PIT validation because it worsened SOG MAE and game diagnostics. Future deployment work must learn conditional role changes from shifts, line combinations, PP units, roster state, scratches, coach/team context and opponent matchup. Historical analogues are evidence, never automatic wager rules.

## Market trajectory

FBIS retains immutable odds snapshots and ACTION observations where available. Decision-time features include opening/current quote, movement, velocity, persistence/reversal, ticket/money divergence, market confirmation/opposition and FBIS edge expansion/decay. Closing data is settlement/CLV evidence only.

## Price and EV

Each moneyline, puck-line, total and supported player-prop offer is evaluated at its actual American price. Missing two-way price => PASS. No assumed -110 is allowed.

## Confidence

NHL-CONFIDENCE-v1 is fail-closed. Raw 0-100 confidence is diagnostic until point-in-time settled evidence establishes:
- adequate samples
- non-decreasing realized win rate across confidence bins
- non-decreasing ROI where estimable
- stable calibration prospectively

Positive raw EV alone creates a research candidate, not an authorized bet.

## Evidence ledger

`nhl_wager_decisions` stores immutable game/prop evaluations. `nhl_wager_settlements` stores outcomes and closing information separately. Original decision rows are never rewritten with close data.

Primary validation metrics: units, ROI, probability calibration, CLV, max drawdown, season stability and confidence monotonicity. Margin/total MAE and winner accuracy remain diagnostics.
