# FBIS NFL SDV v0.3 — Independent Prospective Protocol (2026-10-23)

## Source, engine and authority
- Model: NFL-SDV-VERIFIED-POSSESSION-TRANSITION-SHADOW-v0.3.1
- Comparison: NFL-VERIFIED-POSSESSION-MATCHUP-SHADOW-v0
- Sources: SportsDataverse/nflverse 2024–2026 play-by-play; nflfastR `drive_time_of_possession`, `drive_start_transition`, `drive_end_transition`, `drive_start_yard_line`, `drive_end_yard_line`; plus the reported next possession's observed starting field position.
- Historic source data is postgame-reconstructed. Its availability clock may never be backdated. A forecast counts as prospective ONLY if an immutable receipt was created before kickoff, the specific historical input records existed before that receipt, and a verified final arrived later.
- Original NFL v1.2 is production champion; unchanged. Existing NFL v0.1 is research shadow. CFB v2 remains unchanged.
- `canAuthorizeWager=false` and `canQualify=false` on every research response. No automatic champion cutover.

## Why v0.3 differs from v0.2
Previous NFL v0.2 applied a heuristic +25 seconds to the difference between the timestamps of the first and last recorded snaps. v0.3 uses nflfastR's reported drive time of possession directly, only where it is internally consistent and verifiable. Missing/contradictory values are not estimated. Observed field entry/exit transitions and next-drive start location are stored with each verified possession; within-game linkage is source evidence, not deterministic field-position physics. No return yardage, punts, turnovers, injury stoppages, two-minute clock exception or overtime are modeled with an unsupported assumption.

## Preregistered coverage and cohort rules
1. The SDV history pipeline must load the new fields, preserve source fingerprints as immutable revisions and select the newest eligible revision per source game before the matchup-specific query LIMIT.
2. In any v0.3 research fit, at least 500 valid reported-duration drives, at least 350 linked next-drive positions, at least 65% total source duration+transition coverage and at least 60% linked next-field coverage of source-valid drives. Each opponent must have at least 24 valid offensive and defensive drives and meet the existing minimum team-game requirements. Otherwise the candidate emits no projection.
3. New NFL v0.3 forecasts must be captured prospectively under their *own* stable model ID and receipt ID, distinct from NFL v0.1. The first eligible cohort begins only AFTER production deployment of these v0.3 collectors. No old backtest is retrospectively relabeled.
4. Physical events are deduplicated by canonical participants and exact kickoff; never count two sportsbook/ESPN/nflverse IDs as independent games.
5. Both model receipts must precede kickoff by the system's existing minimum, then have source-verified regulation scores observed only after game end. Grade only **paired outcomes** where both models have immutable receipts and the same verified result.
6. **Minimum 100 eligible paired completed NFL games** for a model-quality decision (30 is a preliminary reporting threshold), with scoring by three-outcome Brier, log loss, winner accuracy, total/margin MAE and signed bias. Use paired bootstrap interval on error deltas. The lower-bound source sample alone does not establish calibration.
7. A candidate may be reviewed only if prospectively paired results show statistically credible improvement with no material degradation in margin, total, regulation winner accuracy or risk metrics, and data quality remains verified. No static performance threshold alone permits automatic promotion. Contemporaneous closing-quote and execution data are required before CLV/ROI claims. All such metrics remain NULL until validated.
8. Results for NFL v0.1 and v0.3 must be separately grouped. Historical reconstructed game replays (including the 31-game prior holdout) may be examined for debugging only, not reused as new independent qualification evidence.

## Operations
- A main-branch SDV historical reharvest collects source duration, entry/exit transitions, source field yardlines, and official score evidence.
- The collector uploads immutable game revisions into **NFL_DB** and audits actual source coverage.
- After successful verified historical ingestion, the NFL prospective task captures **both** independent shadow models for each upcoming eligible game, and later grades them against the same verified regulation outcome.
- Operator-only `/api/football-sdv-prospective?sport=nfl&mode=paired` reports paired metrics, exclusions and readiness with no wager or promotion permissions.
- Incomplete provider duration, contradictory transitions, stale data, missing kickoff times, weak matchup coverage, and missing grading evidence must fail closed.
