# Paired replay results — October 25, 2026

Keep the current production champions. This matched archive does not show a consistent advantage for replacing them with the fitted candidates. The result is descriptive follow-up evidence, not proof that either model is universally better.

Successful [source replay run 40230954990](https://github.com/coachhornsby/fbis/actions/runs/40230954990) used code commit `285d288523ef2b24f9b4f757f77e7563e9d64261` and the fixed model hashes in the original fitting report. It scored 517 paired forecasts from 607 available records across 11 games on seven dates. Ninety earlier-version forecasts had no eligible matching historical design row; all exclusions are recorded. No records failed the prior-settlement agreement check. Current-version forecasts are a separate one-game cohort. No coefficients were refit during this comparison.

## Current production versions: October 24, one game

Mean absolute error (MAE), lower is better. Hitter markets have 18 players each; pitcher strikeouts have two starters. Players in the same game are not independent games.

| Market | Production MAE | Fitted MAE | Player forecasts |
| --- | ---: | ---: | ---: |
| Pitcher strikeouts | 0.750 | 1.941 | 2 |
| Hits | 0.500 | 0.483 | 18 |
| Total bases | 0.922 | 0.977 | 18 |
| Home runs | 0.183 | 0.204 | 18 |

The production pitcher-K calculation reproduced the saved forecasts exactly from the original pregame inputs. Logan Henderson's production projection was 3.8, the fitted projection was 5.171, and the final was 4. Drew Rasmussen's projections were 5.3 and 6.712, with a final of 4. The fitted starting baselines were already 5.300 and 6.836 before learned corrections. This highlights a workload-baseline difference worth investigating; one game does not establish its general cause.

Hits improved modestly in MAE, RMSE and the common-link probability diagnostics. Total bases had worse MAE but better RMSE and slightly better Brier scores on this game, so its evidence is mixed. Home runs had worse MAE and RMSE, with mixed probability diagnostics. These are small, correlated samples; no normal-approximation confidence interval is emitted.

## Earlier production versions: separate cohorts

These forecasts came from earlier model versions, not the current archive/Pal production path. They cannot establish superiority over today's full production model.

| Market | Earlier production MAE | Fitted MAE | Player forecasts | Games |
| --- | ---: | ---: | ---: | ---: |
| Pitcher strikeouts | 1.700 | 1.587 | 16 | 8 |
| Hits | 0.608 | 0.599 | 148 | 9 |
| Total bases | 1.045 | 1.153 | 149 | 9 |
| Home runs | 0.159 | 0.182 | 148 | 9 |

The earlier-version K and hit comparisons improved modestly. Total bases and home runs lost accuracy. Hit probability diagnostics vary by threshold; there is no uniform calibration improvement. Full MAE/RMSE/bias, common-Poisson diagnostics, segments, input hashes and exclusions are in `results/report.json`; matched operands and forecast lineage are in `results/paired-rows.json`.

## Scope of the conclusion

Historical games can train and test fitted models, and were used here. The constraint is the availability of matching saved production forecasts and inputs, not a universal requirement to wait 45 calendar dates. Three years of outcomes are not three years of archived current-production Pal/weather/lineup states. Missing historic context was not invented, and older production versions were not pooled into the current cohort.

This is a follow-up subset after the earlier chronological holdout report was examined. It is not a new untouched holdout or prospective validation of the fitted predictions. The probability diagnostics apply a common Poisson link to both point means; they are not recreated executable exchange probabilities. No prices, ROI or wager permissions are inferred. No champion, production forecast or promotion policy was changed by this research run.
