# FBIS Soccer Model Manual

**System:** SOCCER-FBIS-v1  
**Model version:** research-v2-dixon-coles  
**Status:** RESEARCH  
**Wager authority:** disabled  
**Supported initial leagues:** EPL (`eng.1`), La Liga (`esp.1`), Bundesliga (`ger.1`), Serie A (`ita.1`), Ligue 1 (`fra.1`), MLS (`usa.1`), NWSL (`usa.nwsl`)

## 1. System purpose and philosophy

SOCCER-FBIS-v1 is an independent pre-match soccer probability engine built to identify repeatable pricing errors, not merely predict winners. It estimates a complete goal-score distribution first, then derives 1X2, totals, both-teams-to-score (BTTS), and Asian-handicap probabilities from the same distribution.

The independent model may not ingest sportsbook prices, public betting, market movement, consensus lines, closing lines, expert picks, or market-implied probabilities.

## 2. Market structure and supported markets

Research outputs:
- home/draw/away (1X2);
- totals 1.5, 2.5 and 3.5;
- BTTS yes/no;
- home Asian handicap states at -1.5, -1, -0.5, 0, +0.5, +1, +1.5;
- full score matrix through 9 goals per team.

These are probability research outputs. They are not executable wagers until league/market-specific validation and operator promotion.

## 3. Source catalog and source roles

Independent sources:
- ESPN soccer scoreboard and match-result surfaces;
- SportsDataverse soccer documentation/endpoint map as a supported transport/reference layer;
- future ESPN summary/roster/player-stat enrichment where provenance is point-in-time safe.

Market sources:
- ACTION/Zen research observations and configured sportsbook quotes, joined only after the independent prediction is frozen.

Transport deduplication rule: an ESPN statistic remains one canonical feature even when delivered through more than one transport library.

## 4. Identity/entity normalization

Primary match identity is `league:event_id`.

Team identity priority:
1. ESPN team ID;
2. abbreviation;
3. normalized display name.

League is always part of the match namespace. MLS and NWSL use calendar-year seasons. European domestic leagues use a July season rollover.

## 5. Temporal-integrity and provenance rules

Canonical match history is stored in `soccer_matches`.

For a prediction at cutoff T:
- only matches with `match_date < T` may enter the feature state;
- final scores are labels for their own match and inputs only for later matches;
- market data is excluded from the independent feature matrix;
- source and observation provenance are persisted;
- future rows are ignored even if present in storage.

Historical validation uses expanding walk-forward order.

## 6. Independent feature architecture

Current v1 features are intentionally compact:
- recency-weighted league home-goal environment;
- recency-weighted league away-goal environment;
- team overall attack rate;
- team overall defensive-concession rate;
- home-only attack/defense rates for the home team;
- away-only attack/defense rates for the away team;
- effective and raw history sample sizes;
- days since each team's last match as a diagnostic only.

All rates are market-free.

## 7. Projection model architecture

The model builds expected goals `lambda_home` and `lambda_away`.

Core structure:

`lambda_home = league_home_rate × home_attack_strength × away_defense_weakness`

`lambda_away = league_away_rate × away_attack_strength × home_defense_weakness`

Home/away splits are shrunk toward a mixture of the team's overall rate and the league rate.

A Poisson score matrix is then adjusted with a Dixon-Coles low-score correction and normalized.

The current Dixon-Coles rho, recency half-life, and pseudo-game shrinkage are research parameters. They are not production doctrine until fitted and validated.

## 8. Sport-specific matchup/context layer

Current context:
- venue side (home/away);
- neutral-site flag;
- league scoring environment;
- team home/away split strength;
- rest-day diagnostics.

Rest is not yet applied as a scoring adjustment. It remains diagnostic until causal value is demonstrated out of sample.

Future candidate context:
- travel distance;
- altitude;
- fixture congestion;
- continental/cup scheduling;
- manager changes;
- formation/style interactions;
- weather where material.

## 9. Player/participant state

Player and lineup effects are not required for v1 to emit a team projection.

Planned point-in-time additions:
- expected starting XI;
- goalkeeper identity/shot-stopping state;
- unavailable starters;
- recent minutes;
- player shot and chance involvement;
- substitution/rotation patterns.

Missing lineup data may later increase uncertainty. It may not be silently treated as confirmed availability.

## 10. Uncertainty and missing-data behavior

Uncertainty uses team history sample and league history sample.

Current states:
- HIGH: sparse team or league history;
- MEDIUM: moderate history;
- LOW: mature sample.

If canonical history is unavailable, the system may use the legacy season team-form fallback. That fallback is explicitly marked high uncertainty.

If neither canonical history nor usable team form exists, the projection fails closed.

## 11. Market roles and line/price semantics

Market hierarchy follows the FBIS standard:
1. FBIS PURE independent projection;
2. EXECUTION_MARKET;
3. CONSENSUS / MARKET_INTELLIGENCE / OBSERVED;
4. REFERENCE_MARKET.

A 1X2 comparison must remove vig across all three outcomes before calculating model-market disagreement.

Asian-handicap and total line plus price are a coupled quote.

## 12. Research/residual edge layer

For each market observation:
- convert offered prices to implied probabilities;
- remove vig using the complete market set;
- compare model probability with no-vig market probability;
- preserve model timestamp and market timestamp;
- classify edge bucket;
- later grade result and closing-line movement.

Market data never feeds backward into `lambda_home` or `lambda_away`.

## 13. Qualification/gatekeeper policy

Default:
- `canQualify=false`;
- `canAuthorizeWager=false`;
- `maturity=RESEARCH`.

Promotion requires, at minimum:
- adequate true walk-forward sample;
- stable league-level calibration;
- no-vig market benchmark;
- edge-bucket stability;
- prospective shadow evidence;
- no temporal-integrity failures;
- operator approval.

Numeric qualification thresholds must be fit from soccer evidence, not inherited from NFL/CFB/MLB.

## 14. Execution and staking semantics

No soccer execution is currently authorized.

When authority is later granted:
- an actual configured execution quote is mandatory;
- stake sizing must use the production bankroll policy;
- consensus/reference prices cannot be substituted for executable prices;
- each bet must preserve the exact line and price.

## 15. Prediction snapshot and audit schema

Canonical prediction snapshots must preserve:
- event ID and league;
- kickoff time;
- prediction cutoff;
- model ID/version/code SHA;
- expected home/away goals;
- 1X2 probabilities;
- totals/BTTS/AH probabilities as applicable;
- uncertainty;
- provenance and feature version;
- qualification state/reasons;
- market observation only in downstream market fields.

## 16. Historical backtest design

Primary historical evaluator: `scripts/soccer-form-walkforward.mjs`.

Method:
- chronological expanding history;
- prediction before each eligible match;
- no random split;
- future rows ignored;
- league-level metrics retained.

Required outputs:
- home/away goal MAE;
- margin MAE/bias/RMSE;
- total MAE/bias/RMSE;
- 1X2 accuracy;
- Brier score;
- log loss;
- probability calibration;
- O/U 2.5 Brier;
- BTTS Brier.

## 17. Prospective validation

Historical success does not grant wager authority.

After historical gates pass, SOCCER-FBIS-v1 must run prospectively in shadow mode with frozen parameters. Changes restart or version the prospective evidence window.

## 18. Metrics and benchmark hierarchy

Primary model-quality metrics:
1. log loss;
2. Brier score;
3. calibration error;
4. margin/total error;
5. league/uncertainty stability.

Market-value metrics:
1. residual probability advantage vs no-vig market;
2. closing-line value where a reliable close exists;
3. flat-stake return by edge bucket;
4. drawdown and variance;
5. sample size.

Raw hit rate is never sufficient.

## 19. Continuous-learning governance

Soccer participates in the canonical weekly continuous-learning monitor.

Automatic monitoring is allowed. Automatic production promotion and automatic wager-authority expansion are prohibited.

## 20. Promotion/rollback governance

Promotion requires explicit operator approval and a versioned evidence record.

Rollback triggers include:
- calibration break;
- source/provenance failure;
- temporal leakage;
- sustained benchmark deterioration;
- identity mismatch;
- data freshness failure.

Rollback disables qualification before model display is removed.

## 21. Production jobs/workflows

Key files:
- `.github/workflows/soccer-form-backfill.yml` — canonical ingest/backfill;
- `.github/workflows/soccer-form-walkforward.yml` — true walk-forward evidence;
- `.github/workflows/soccer-market-benchmark.yml` — no-vig market benchmark;
- `functions/api/soccer-form-backfill.js` — protected ingest endpoint;
- `functions/lib/soccerFbisV1.js` — independent model;
- `functions/lib/slateEngine.js` — live research attachment.

## 22. Health, freshness, and failure behavior

The canonical target table is `soccer_matches`.

The D1 schema health check expects migration `0039_soccer_canonical`.

Missing source data, missing history, malformed scores, unsupported leagues, and missing schema fail closed. Paid market acquisition remains budget-guarded.

## 23. Dashboard/operator presentation

The board may display:
- expected score;
- 1X2 research probabilities;
- totals/BTTS research probabilities;
- uncertainty;
- model/version;
- RESEARCH status.

It may not label soccer research probabilities as calibrated executable EV until calibration and qualification gates are approved.

## 24. Known limitations and prohibited shortcuts

Known limitations:
- v1 begins from score/result history; richer shot/player context is incremental work;
- Dixon-Coles rho is provisional research configuration;
- lineup availability is not yet an active scoring input;
- league interactions are not yet pooled hierarchically.

Prohibited:
- using closing prices as model features;
- using final-season aggregates for earlier historical games;
- treating transport duplicates as separate features;
- inheriting betting thresholds from another sport;
- authorizing wagers from the research model without promotion evidence.

## 25. Current model registry/status

`SOCCER-FBIS-v1`
- family: PURE;
- role: challenger;
- maturity: RESEARCH;
- independent: true;
- market-informed: false;
- canQualify: false;
- canAuthorizeWager: false.

## 26. Change log

### 2026-10-04 — research-v2-dixon-coles
- added canonical soccer match history;
- added point-in-time loader;
- added NWSL;
- corrected calendar-year MLS/NWSL season keys;
- replaced simple goal-form projection with recency-weighted home/away attack-defense rates;
- added Dixon-Coles score correction;
- added 1X2, totals, BTTS and Asian-handicap probability surfaces;
- expanded walk-forward validation;
- retained fail-closed research governance.
