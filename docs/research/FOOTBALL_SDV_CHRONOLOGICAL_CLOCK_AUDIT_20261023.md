# FBIS Football — Chronological CFB and NFL Clock Research (2026-10-23)

**Approved status:** Research only. **Production NFL v1.2 / CFB v2 remain unchanged.** No wagering authority or automatic model-promotion entitlement.

## Provenance
- Implementation: [PR #1642](https://github.com/coachhornsby/fbis/pull/1642)
- Successful SDV paired replay: [GitHub Actions run #40060529678](https://github.com/coachhornsby/fbis/actions/runs/40060529678)
- Immutable output archive: [artifact #12547088367](https://github.com/coachhornsby/fbis/actions/runs/40060529678/artifacts/12547088367)
- Samples: **163 CFB paired games** and **31 NFL paired games**, from matched frozen 2026 FBIS snapshots and independently reconciled SDV regulation-only outcomes.
- Source class: **postgame-reconstructed historical**, not contemporaneously verified 2026 pregame SDV capture. Do not relabel as prospective or claim market profitability.

## CFB — strict date-disjoint holdout

Alpha is fitted against earlier games only, optimizing absolute total error using candidate weights {0,.05,.1,.2,.35,.5,.75,1}, then frozen for the later games. Games sharing a UTC date stay together; this eliminates an earlier within-day boundary issue.

| Measurement | Historical train (82 games) | Chronological holdout (81 games) |
| --- | ---: | ---: |
| FBIS v2 total MAE | 13.39 | **12.5160** |
| Total-only blend MAE (alpha=.75) | 12.06 | 12.7402 |
| Holdout delta (candidate minus FBIS) | — | **+0.2242** |
| Holdout paired bootstrap 95% interval | — | [-0.9069,+1.3450] |

**Decision:** No validated total-only improvement. The candidate was fitted to training; later evidence did not confirm value. The projected FBIS margin is preserved by construction, but that does not qualify the blended total.

Separately, a signed-margin bias shift was fitted on the same earlier dates, preserving the champion total (not simultaneous with the total blend).

| CFB margin evaluation | Train (82) | Holdout (81) |
| --- | ---: | ---: |
| FBIS v2 margin MAE | 10.7037 | 14.2840 |
| Fitted +2-point margin shift MAE | 10.5354 | 14.2617 |
| Holdout delta | — | -0.0222 |
| Holdout bootstrap 95% interval | — | [-0.4346,+0.4099] |

**Decision:** The estimated 0.02-point holdout gain is economically/statistically unproven; no promotion.

## NFL — source clock/field-position experiment (31 paired games)

The **NFL-VERIFIED-PLAYCLOCK-FIELD-SHADOW-v0.2** challenger uses nflverse pre-play clock readings to reconstruct only a *lower bound* on possession elapsed time. The additional 25-second end-play allowance is explicitly assumed. Starting field position is empirical, but return/punt/turnover transitions and the exact possession clock are **not** fully modeled. Training requires source clock coverage, not fabricated clocks.

| Metric | Frozen FBIS v1.2 | Original empirical challenger v0.1 | Clock/field challenger v0.2 |
| --- | ---: | ---: | ---: |
| Same-game n | 31 | 31 | 31 |
| Margin MAE | **9.3839** | 9.9247 | 9.9148 |
| Total MAE | 12.1710 | 12.1811 | **12.1135** |
| Projected-winner accuracy | 61.29% | 54.84% | **61.29%** |
| Signed total bias | -0.9452 | -3.1183 | **-7.7006** |
| v0.2 Brier (three-outcome) | not compared | 0.5111 | 0.5003 |

Clock challenger minus champion margin MAE = +0.5310, paired bootstrap 95% interval [-0.8422,+1.8880]. Total MAE delta = -0.0574, paired interval [-2.5086,+2.4714].

**Decision:** **No demonstrated improvement**. The v0.2 model materially underestimates expected game totals; correct or explain that bias using development folds before further holdout testing. Do not retroactively fit to this 31-game holdout.

## Separate prospective evaluation

The real pregame SDV challenger receipt + postgame regulation-only grader remains a distinct path. Backfilled reconstructed historical observations do **not** become prospective receipts. Until enough completed prospective games have verified scores, probability buckets, ROI, and CLV remain unqualified or unavailable. A reporting threshold is not wagering authorization.

## Next independent research design

1. NFL: obtain exact drive start/end timestamps and reliable turnover/punt/field-position transitions (rather than lower-bound first-to-last snap clocks); use a **new training cohort**, and predeclare a fresh test period. Compare not just total MAE but signed bias, log loss, margin MAE and winner calibration.
2. CFB: fit offense/defense hierarchical effects and pace/strength by multi-season forward folds; diagnose the champion's strengths before designing margin correction. Treat the current 81-game holdout as spent.
3. Run both against frozen FBIS, closing-line benchmarks on the same games and future prospectively graded official outcomes.
4. No production routing or wagering authority without independently signed evidence of improvement, model provenance and economic backtesting.

**Platform learning candidate:** The reusable UTC-day holdout isolation, source-evidence clock requirements, paired confidence intervals and negative-result audit should inform the platform research stack. Football scoring parameters do not transfer to other sports by default.
