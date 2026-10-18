# NFL Predictive Lift — Phase A executive findings

**Champion unchanged:** NFL-PRO-v1.1. All challengers research-only. Wagering/qualification gates unchanged.

## 1. ARI@LAR residual gap

**Cause:** team-abbreviation join (`LA` in nflverse PBP vs `LAR` in snapshot).  
**Fix:** canon map in `scripts/nfl-enrich-snapshot-pbp-families.py` (LAR now enriches; 192/192 fields).  
**Not:** cache redesign, event-join rewrite, or pipeline redesign.

## 2. Chronological ablation (n=2176, identical windows)

| Config | Margin MAE | Δ vs CORE | Δ vs market |
|---|---:|---:|---:|
| CORE (EPA+QB) | 10.2600 | — | +0.406 |
| + success | 10.2039 | **−0.056** | +0.350 |
| + earlyDown | 10.2621 | +0.002 | +0.408 |
| + explosives | 10.2585 | −0.002 | +0.404 |
| + pressure (sack) | 10.2499 | −0.010 | +0.396 |
| + tracking | 10.2600 | 0* | +0.406 |
| + context | 10.2676 | +0.008 | +0.413 |
| v1.1 exact (reproduced) | **10.1993** | −0.061 | +0.345 |
| Closing market | **9.8543** | — | — |

\*Tracking not evaluable: pinned training CSV has **zero NGS columns**.

Bootstrap CIs: success and full v1.1 show positive abs-error reduction vs CORE whose 95% CI excludes 0. Solo early-down / explosives / pressure / context do not.

## 3. Where errors originate

- Team EPA+QB core already carries most signal.
- Success-rate efficiency is the only single family with clear OOS lift on this matrix.
- Remaining gap to market (~0.35 MAE) is not closed by explosives/pressure/context alone on historical features.
- Season slices retained in `research/nfl/phase-a-ablation-20261018.json`.

## 4. Predictive ≠ betting

v1.1 flat −110 ATS on |model−close|≥1: ~51.5% hit, **negative** units/ROI.  
Lower MAE vs CORE does **not** produce profitable disagreement betting on this rule. CLV unavailable (`null`).

## Acceptance

Reproducible paired comparison with bootstrap uncertainty and season slices: **yes**.  
`promotionEvidencePass`: **false**.

## Next (Phase B candidates)

1. Rebuild training matrix with NGS so tracking ablation is real (keep v1.1 CSV hash pin intact as legacy).
2. Target residual market gap with matchup/personnel features that survive season and spread-band slices.
3. Price-aware evaluation (calibration + contemporary closes) before any qualification discussion.
