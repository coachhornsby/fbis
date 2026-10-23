# NFL + CFB SportsDataverse historical possession research audit — 2026-10-23

## Evidence provenance
- Original completed workflow: https://github.com/coachhornsby/fbis/actions/runs/40010904561
- Original immutable artifact: https://github.com/coachhornsby/fbis/actions/runs/40010904561/artifacts/12525768411
- Collection timestamp: 2026-10-23T19:23:14Z (per D1 source_observed_at)
- SDV source material collected **after** past events; historical tests are reconstructed, **not prospectively certified**.
- NFL/CFB models retain `canAuthorizeWager=false`, `canQualify=false`.
- Neither current sport champion, production wagering decisions, nor original frozen CFB V2 receipts changed.

## Independently confirmed database results
| Sport | Games | Reconciled drives | 2024 | 2025 | 2026 |
| --- | ---: | ---: | ---: | ---: | ---: |
| NFL_DB | 429 | 9,052 | 177 | 183 | 69 |
| CFB_DB | 1,337 | 31,205 | 611 | 529 | 197 |
| Total | 1,766 | 40,257 | 788 | 712 | 266 |

The collector considered 664 NFL and 2,411 CFB scheduled PBP games. The original manifest incorrectly reported `scheduledGames=2555.5` because an NFL closing total shadowed the cumulative counter. The corrected source counts **3,075** as 664+2,411. Original artifact is intentionally retained unchanged; no retrospective rewriting.

## Research backtests (postgame-reconstructed; not strict historical PIT)
- NFL: 200 games, 150 simulated paths/game; 2025=183, 2026=17.
- CFB: 180 games, 150 simulated paths/game; all from 2025. 18 held-out cases lacked prior team scoring history and 2 had insufficient matchup drive history.
- These are exploratory sample metrics only, not production-qualified calibration.

| Metric | NFL | CFB |
| --- | ---: | ---: |
| Multiclass regulation Brier | 0.5009 | 0.4675 |
| Multiclass regulation log loss | 0.7346 | 0.6944 |
| Margin MAE (points) | 10.4819 | 17.0710 |
| Total MAE (points) | 10.3863 | 13.3907 |
| 14+ blowout Brier | 0.1387 | 0.1956 |
| Mean maximum regulation lead frequency | 58.07% | 60.84% |

### NFL historical closing-line benchmark (n=200)
| Metric | Empirical challenger | Historical market reference |
| --- | ---: | ---: |
| Margin MAE | 10.4819 | 9.5100 |
| Total MAE | 10.3863 | 10.0550 |

This challenger **underperformed the historical closing-line reference** on margin and total MAE in this cohort. Do not promote this model or advertise an economic edge. The closing-line reference was acquired retrospectively: it is not a contemporaneous quote receipt, CLV, executed bet or ROI.

## Source-rejection health
- NFL rejected 235/664 source games. Leading reasons: drive score discontinuity (173), overtime (40), incomplete drive coverage (12), possession identity conflict (9), unsupported drive scores (1).
- CFB rejected 1,074/2,411. Leading reasons: noncontiguous ESPN drive IDs (522), unresolved canonical identity (326), score regression (75), overtime (63), unsupported drive points (50), team/score coverage (24), final score mismatch (8), missing drive context (6).
- Do not loosen validity rules to inflate coverage. Investigate the 522 noncontiguous-drive cohort independently; reconcile source semantics before changing canonical normalization.

## Remaining requirements
1. Dedicated source-quality repair for rejected games with verified provider documentation and refreshed immutable evidence.
2. Benchmark challengers against a point-in-time frozen champion in paired folds; current backtest uses lagged team-scoring priors, not a verified champion replay.
3. Record immutable **new** pregame predictions before the actual kickoff. Match them with regulation-only official outcomes as events finish.
4. Quantify prospective win probability reliability, Brier/log loss, margin/total errors and interval coverage with sample and uncertainty gates.
5. Join contemporaneous market quote snapshots and actual eligible execution receipts before computing CLV, risk-adjusted returns or ROI; leave absent fields NULL.
6. Maintain separate NFL and CFB research cohorts. Model promotion requires independent proof and approval, not retrospective fit.

## Authority and platform learning
**PLATFORM LEARNING CANDIDATE:** Reusable reject-reason ledger, immutable postgame source fingerprints, prospective-versus-reconstructed evidence class, and paired research versus market baselines may benefit other FBIS sports. Predictive coefficients/priors must **not** transfer cross-sport without validation.
