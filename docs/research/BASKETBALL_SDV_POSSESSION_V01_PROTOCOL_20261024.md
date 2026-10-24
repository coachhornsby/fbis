# FBIS NBA/CBB possession-level simulation expansion — Phase A (2026-10-24)

## Scope and existing foundation

**NBA:** Production FBIS already has \`nbaModel.js\`, deep v2, prospective snapshots and a canonical ESPN game/boxscore pipeline. The NBA SDV player-history feed is shadow/research only and is not a rights-cleared production or player-prop source.  
**CBB:** FBIS already has \`cbbPossessionModel.js\`, \`cbbNcaaPossessionModel.js\`, historical CBB possession/lineup artifacts, v2 margin/total corrections, and walk-forward pipelines. These are reused, not replaced.

Official SportsDataverse references:
- NBA NBA Stats play-by-play \`load_nba_stats_pbp\` with \`possession_number\`, \`order_index\`, \`period\`, and team/action fields: https://py.sportsdataverse.org/docs/nba/reference/loaders/stats
- Men's college basketball ESPN/NCAA possession PBP and \`poss_num\` / \`poss_team_espn_team_id\` via existing FBIS NCAA adapters; https://py.sportsdataverse.org/docs/mbb/reference/loaders/other
- SportsDataverse Python source: https://sportsdataverse-py.sportsdataverse.org/docs/intro

## New independent challengers

| | NBA | Men's college basketball (CBB) |
|---|---|---|
| Model ID | NBA-SDV-EMPIRICAL-POSSESSIONS-SHADOW-v0.1 | CBB-SDV-EMPIRICAL-POSSESSIONS-SHADOW-v0.1 |
| Regulation structure | 4 × 12-minute quarters | 2 × 20-minute halves |
| Possession counts | Validated 75–130 per team | Validated 45–100 per team |
| Empirical scoring | Verified 0–6-point possession outcomes | Verified 0–6-point possession outcomes |
| Opponent conditioning | Blend observed offense possession outcomes with opponent defense allowed possession outcomes | Same structure, but separate CBB data and parameters |
| Pace | Empirical same-league recent team pace, resampled | Empirical same-league recent team pace, resampled |
| Minimum verified team games | 8 prior games each | 8 prior games each; also at least 3 current-season observations per team |
| Pre-tipoff rule | Source observation must precede forecast freeze, which must precede tipoff | Same; transfers/roster changes force current-season minimum |
| Overtime | Explicitly excluded from regulation model | Explicitly excluded |
| Production and wagers | NO cutover; \`canQualify=false\`, \`canAuthorizeWager=false\` | Identical fail-closed controls |

These v0.1 scoring distributions are *empirical, descriptive research assumptions* (50% attacking team outcomes / 50% opponent defense allowed) rather than validated fitted coefficients. **Unit tests with constructed fixtures are not performance evidence.**

## Source validation requirements

1. Each historical game needs its canonical game and team IDs, exact tipoff, *actual acquisition/source-observation timestamp*, raw source fingerprint, full regulation possession list, and independently verified regulation final. Recorded points by team must exactly reconcile with the verified regulation score. Source readings with different final scores, missing possession owners, out-of-order possession events, or overtime-only results must be blocked.
2. CBB may use the existing NCAA \`poss_team_espn_team_id\` / \`poss_num\` evidence from the SportsDataverse NCAA pipeline; no college “player played, therefore available” assumptions are allowed.
3. NBA Stats \`team_id\` refers to event/action team, **not a verified possession owner**. The new adapter can verify NBA ownership from all five offensive lineup IDs (\`off_player_1\` through \`off_player_5\`) only when every player maps to the same team in an independently verified game-roster crosswalk with source fingerprint. Unavailable, partial or conflicting lineup evidence fails closed; action team never substitutes for offense.
4. Raw release first downloaded after a game's finish may train a **later** forecast only. The source observed timestamp cannot be rewritten to the original historical game date to create fake prospective predictions.
5. Existing NBA production ingestion/licensing gates remain enforced. Historical public SDV records do not automatically authorize commercial redistribution or real-time player-stat board use.

## Exit criteria for Phase B

- Run authoritative SDV possession extraction and verification for both leagues. Report accepted/rejected games, unknown NBA owner percentage, score reconciliation and rights status. Upload hashes and reports to immutable R2 storage under league-specific research prefixes; no switch to authoritative sport databases.
- Pair independently frozen FBIS NBA and CBB baseline projections to the same completed historical games using exact canonical matchup/tipoff; validate chronological out-of-time folds without reading target or held-out outcomes.
- Start **new** NBA/CBB per-game immutable prospective forecast receipts and regulation-only grading; dedupe provider IDs to physical games; follow source-revision integrity checks implemented for NFL/CFB.
- Report regulation 3-way Brier/log loss, win probability calibration, winner accuracy, margin/total MAE, paired bootstrap intervals, market close comparisons with same-time quote receipts, and sample exclusions separately per sport.
- No model promotion, live SIM RANKINGS changes or wagers until independent holdout/prospective and applicable rights checks pass.

**Platform learning:** Reuse shared evidence/control mechanics across sports, not predictive football parameters; each sport has its own league/clock, source lineage, season boundaries, baseline and qualification decision.
