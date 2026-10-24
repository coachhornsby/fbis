# FBIS NFL/CFB Empirical Simulation — Paired SDV Audit (2026-10-23)

**Run:** https://github.com/coachhornsby/fbis/actions/runs/40047245186  
**Artifact:** https://github.com/coachhornsby/fbis/actions/runs/40047245186/artifacts/12542310154  
**Source:** 2024–2026 SportsDataverse historical play-by-play, reconciled in separate NFL/CFB D1.  
**Evidence class:** \`RECONSTRUCTED_HISTORICAL_NOT_PIT\`, not prospectively certified.

The pairing uses the **same regulation result for each sport and its frozen original FBIS projected score** (NFL v1.2; CFB v2), then executes the empirical drive challenger using that original score as an input. This is an *incremental ablation* against the baseline, not an independent challenge to the FBIS champion. Team identity, kickoff, and frozen timestamp must match. CFB matched by ESPN game ID; NFL matched by exact away/home abbreviation + kickoff minute.

## Verified paired performance

| Metric | NFL champion | NFL challenger | CFB champion | CFB challenger |
| :-- | --: | --: | --: | --: |
| Same-game sample n | 31 | 31 | 163 | 163 |
| Margin MAE | 9.3839 | 9.9247 | 12.4828 | 15.3227 |
| Total MAE | 12.1710 | 12.1811 | 13.3000 | 12.7383 |
| Winner accuracy | 61.29% | 54.84% | 68.71% | 59.51% |

Eight of 171 candidate CFB games failed minimum team drive-history coverage. No artificial padding or provider backdating was applied.

Paired **challenger minus champion** margin-MAE difference:

- NFL: +0.5409 points, paired-bootstrap 95% interval **[-1.1471, +2.1381]**; improvement not established.
- CFB: +2.8399 points, paired-bootstrap 95% interval **[+1.2187, +4.3330]**; deterioration on this reconstructed sample.
- NFL total MAE: +0.0101 points (approximately unchanged).
- CFB total MAE: -0.5617 points, paired-bootstrap interval **[-1.7189, +0.6566]**, inconclusive.

## Decision

- **Do not promote** the empirical challenger to production for NFL or CFB.
- NFL margin/total performance is not meaningfully better than FBIS v1.2. Existing full-game simulation remains research-only until independently fitted and prospectively assessed.
- CFB empirical drive resampling makes margin predictions materially worse in this sample; first remedy game-state weighting and offense/defense matchup conditioning in a new experiment, with temporal splits.
- CFB total-only adjustments could be investigated while keeping the original FBIS margin, but the current data do not prove a reliable total improvement.
- Avoid using these backtests to certify probability calibration, ROI, edge or wagering permission. Prospective research captures and regulation-only grading are tracked separately in \`football_sdv_prospective_receipts\` and \`football_sdv_prospective_grades\`.

## Source quality and coverage

- 429 NFL games / 9,052 drive records, 1,337 CFB games / 31,205 drive records existed in the source qualification cohort.
- The original 52 CFB replay receipts are separate, not evidence of 52 independently accurate forecasts.
- NFL/CFB output names and probability spaces require regulation settlement scope. Never mix overtime finals into a regulation-only evaluation.
- Provider duplicate IDs can represent a single event; prospective grading must deduplicate by canonical teams and kickoff.

**All research paths retain \`canAuthorizeWager=false\`; no champion routing or public SIM RANKINGS probability is changed by the paired report.**
