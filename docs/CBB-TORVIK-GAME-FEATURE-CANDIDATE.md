# FBIS CBB Torvik game-feature candidate

Built and evaluated FBIS-CBB-TORVIK-GAME-FEATURES-v1, a 32-feature game-level candidate that uses no KenPom values or market lines. It expands Torvik use beyond adjusted-efficiency comparison: rolling offense, defense, pace, venue, rest, offensive/defensive Four Factors, three-point attempt share and recent offensive/defensive form. This candidate is implemented and runnable offline; it is not promoted as a proven improvement.

## Source and feature construction

The previously archived Torvik 2026 getgamestats capture has 11,504 team rows representing 5,752 unique games. Its embedded 38-field game box structure follows the toRvik team-game box definition. Duplicate team perspectives are deduplicated and venue metadata reconciled. Ten games fail shooting/score or rebound arithmetic and are excluded from both history and targets, leaving 5,742 usable games. No raw full-season adjusted rating, tournament outcome, future game or market line enters a historical pregame feature.

Each date is processed in two stages: build every game feature from earlier dates, then apply all completed results for that date. No same-day result can leak into another prediction when tip times are unavailable. At least three prior games on both sides are required for evaluation. Rolling rates use five pseudo-games of disclosed fixed priors: 72 points, 70 possessions, .50 effective FG, .18 turnover rate, .28 offensive-rebound rate, .30 free-throw attempt/field-goal attempt rate, and .37 three-point attempt share. These are modeling assumptions, not newly measured provider fields.

Pace normalizes overtime using summed player minutes with a 200-minute regulation floor; captured fractional/short player-minute totals do not inflate pace. Targets are final scores including overtime. Neutral venue is source-reported; neutral team ordering creates no home-court flag. Rolling opponent points are used as defense; this is not a fully opponent-adjusted iterative rating fit. Recent-form changes compare the preceding five games with the smoothed cumulative profile. Rim and midrange location splits are not inferred from these aggregate box scores.

## Chronological evaluation

- Training: 1,592 eligible games before January 1, 2026.
- Validation: 1,549 January games. Choose ridge strength from the fixed set 1, 10, 100 on combined margin/total MAE, using training-only standardization.
- Refit selected configuration on training plus validation.
- Held-out test: 1,989 games from February onward. Test outcomes are never used to select ridge strength.

| Candidate | Held-out margin MAE | Held-out total MAE |
| --- | ---: | ---: |
| Eight-feature rolling efficiency/pace/venue/rest baseline | 9.0632 | 13.5166 |
| 32-feature Four Factors/shooting/recent-form candidate | 9.0565 | 13.6024 |

The margin difference is only 0.0067 points and total error worsens by 0.0858 points. The expanded model also fails to beat the baseline on January validation. Neither improvement nor statistical significance is established. Do not promote this model, claim a betting edge or tune further against this already inspected test period. The held-out comparison is against this explicit rolling baseline, not against KenPom or the frozen CBB-PRO system; no historical pregame KenPom/CBBD benchmark capture was supplied for an equivalent comparison.

The saved candidate coefficients refit on all completed 2026 source examples for prospective research only. That refit must not be used to recompute the reported held-out test. No current-season forecast was published from those coefficients: applying a full prior-year team profile across 2027 roster turnover is not validated.

## Current integration and roster context

A private 365-team feature-coverage file joins current Torvik identities, historical game profiles, existing current CBBD roster coverage and reviewed roster-history coverage. Historical profiles match 364 of the current 365 teams; current CBBD roster data exists for all 365. Unmatched history remains absent. Partial player identity/retention and missing expected minutes remain unknown. Roster counts are evidence coverage, not impact coefficients. Roster/minutes effects require multi-season preseason validation, not an invented bonus/penalty.

KenPom stays outside the new feature model and remains a separate private benchmark. Current CBBD adjusted ratings are still empty, while current CBBD rosters are used for the coverage join. This demonstrates why an empty ratings endpoint must not be described as absence of all CBBD data.

## Delivery and next experiment

Run `PYTHONDONTWRITEBYTECODE=1 python scripts/cbb-torvik-feature-model.py` from the repository root with the existing private Torvik capture. The script makes no network or D1 calls and writes evaluation, fitted candidate coefficients and team-history profiles under ignored artifacts/cbb-torvik-feature-model. The private coverage join and source/manifest receipts accompany the archive. The original capture's SHA-256 is recorded in evaluation.json.

Five new tests cover same-day/future-result leakage, Four Factor arithmetic, constant-feature ridge stability, deduplication and corrupt-box exclusion. Together with existing CBB Python tests, 34 pass. Frozen production rules, current private primary forecasts, the public scoreboard, seven-sport scope and $10/month ceiling remain unchanged.

Next work: obtain earlier-season game boxes and dated roster/rotation history for a separate preseason test; add roster retention only where identities/minutes are supportable; compare opponent-adjusted and shot-location candidates using a new untouched evaluation period. Existing current data can support feature inspection, not proof that a richer model improves opening-night projections. Grok should prioritize missing historical inputs and official availability evidence, not duplicate the saved 2026 capture or repeatedly pull current ratings. No recurring collection, purchase or production change is part of that research assignment.
