# FBIS CBB team profiles — shared Tier 3 API allowance

**Date:** 2026-10-15. **Mode:** RESEARCH ONLY.

## Subscription accounting
- CFBD + CBBD use one **75,000**-call monthly Tier 3 allowance, not 75k per sport.
- FBIS target: **30,000** combined calls/month, with alerts at 30k, 45k, 60k, 67.5k and 75k.
- The shared network receipt gate retains its more conservative defaults:
  **45 requests/day** and **1,400/month** across both providers unless deliberately configured otherwise.
- The separate 67,500 local-usage check is a discretionary-stop guard, not a license to spend the whole Tier 3 cap.
- Provider-reported remaining credits take priority over local estimates: external calls and other clients can consume the shared quota without appearing in FBIS's D1 ledger.
- A missing D1 database or receipt/control schema must fail closed. Do not reset apparent usage to zero on a query error.
- Never use a per-team API loop or a page-view-driven CBBD request.
- Cache or stored D1 snapshots power all user-facing team profiles.

## Initial profile ingestion
- Scheduled owner: `cbb-current-refresh` from `/.github/workflows/college.yml`.
- One bulk `GET /stats/team/leaderboard?season=YYYY` request. This yields team metadata, season scoring, offense and opponent four factors, adjusted efficiency and shooting mix.
- Season uses **ending year** (October 2026 starts season `2027`).
- Store immutable, retrieval-timestamped research snapshots in `cbb_team_profile_snapshots`.
- Resolve teams against FBIS canonical team directory; quarantine unmatched/duplicate or mismatched-season rows.
- Store NULL when provider fields are unavailable; do not infer opponents' shot-location maps.
- Research snapshots never acquire production projections, model qualification, or betting authority.
- Historical final-season data collected today is NOT valid as a past pregame feature.
- Private authenticated reader: `GET /api/cbb-team-profiles?teamId=<canonical>&season=<ending-year>` using existing harvest auth. **0 external calls**.

## Deployment gates
1. Verify current production database state and run the new `0106_cbb_team_profile_snapshots` migration through the normal database procedure. Do **not** improvise migration order while current storage repairs are pending.
2. Run the offline quota, CBB profile, and college regression tests before merging.
3. Confirm existing football acquisition still works; do not remove or weaken the cross-sport D1 reservation gate.
4. Once merged and database-ready, use the preexisting operator-approved CBB backfill for historical `season=2026` (2025–26). Current `season=2027` will fill after game data exists.
5. Audit actual provider remaining calls, monthly D1 usage split by provider, 429s, coverage/match rates, and storage errors. Do not assert 75k remaining without provider evidence.

## Explicitly deferred
- Player-level team profile and full roster integration
- Additional per-conference shooting calls or opponent shot-location derivation
- A public raw data API or raw data redistribution
- Model promotion or wager eligibility

**Economic acceptance:** profile completeness + PIT integrity first, then separate challengers validated prospectively against contemporaneous PinnOdds prices and CLV. No inherited production authority.
