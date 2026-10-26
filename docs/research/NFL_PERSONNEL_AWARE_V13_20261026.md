# NFL-PRO v1.3 — Personnel-aware research challenger (2026-10-26)

## Scope and governance

- Research-only, no changes to existing NFL v1.2 frozen predictions, model coefficients, or wager decision functions.
- Independent as-of availability observation is stamped AFTER its frozen v1.2 input score and BEFORE kickoff. The two timestamps are never conflated.
- No retrospective correction of the October 25 SF@ATL game. A postgame injury report cannot be backdated into a pregame prediction.
- No market inputs or automatic model promotion. Every response sets `canQualify=false` and `canAuthorizeWager=false`.
- Current personnel coefficients are conservative structural assumptions, NOT trained, calibrated, or demonstrated profitable. Research is not sufficient to authorize a wager.

## What changes

1. `functions/lib/nflPersonnelChallenger.js` consumes player profiles from NFL_DB only, including current sourced health status, source timestamps, depth and historical snap share.
2. The research engine counts verified WR1–WR5 absences and introduces a separate high-impact penalty for simultaneous top-target depletion. A healthy QB does not suppress that signal. It also calculates support-position attrition and bounded replacement capacity.
3. Verified reports older than policy windows, carried states, and post-as-of source timestamps are excluded. Missing WR depth or critical provenance blocks the numerical adjustment rather than assuming health.
4. `SIM RANKINGS` retains its frozen v1.2 5,000-path game distributions and displays a separate v1.3 1,000-path challenger only when preflight passes. This is an independently dated RESEARCH estimate.
5. Authorized `POST /api/nfl-personnel-research?mode=capture` stores first-observed immutable EARLY (>4h to 72h before kickoff) and LATE (15min–4h before kickoff) paired research predictions in NFL_DB. Duplicate attempts cannot overwrite an existing checkpoint.
6. Authorized `POST /api/nfl-personnel-research?mode=grade` fills official final-score comparison fields only for completed, non-overtime ESPN games.
7. Public `GET /api/nfl-personnel-research?mode=summary` reports paired margin/total absolute-error cohorts. Severe-receiver-group evidence is reported separately.
8. `.github/workflows/nfl-personnel-shadow.yml` applies the additive schema to NFL_DB on release, waits for the deployed SHA, then captures, grades and reports every three hours. When evidence or credentials are missing, it fails visibly rather than manufacturing output.

## Quantitative caveats

The v1.3 WR model uses last-known snap share as an exposure proxy and does NOT model actual targets, separation, chemistry, depth-specific route shares, opponent coverage, or verified substitute player efficiency. No claim that its point penalties represent causal injury effects is justified yet.

Paired checkpoints from the same game are NOT independent observations. Before any proposal to replace v1.2, conduct event-level, point-in-time walk-forward tests with distinct games; compare margin MAE, total MAE, Brier score when calibrated game probabilities exist, uncertainty, and executable line/price results. Low-sample outliers such as SF@ATL are diagnostics, not training targets.

Until prospective outcomes and economic grades exist, model status remains **SHADOW / NOT VALIDATED**.

## Acceptance checks

- 5 WR absences with QB active creates a receiver-unit warning and may change secondary research score.
- Future timestamps, stale/carried injuries, missing profiles, and post-kickoff snapshots never receive a numerical personnel adjustment.
- No write to primary database, frozen prediction snapshots, published champion scores, or wagering qualification.
- The research score never replaces the baseline in the ranking table.
- Production is not considered verified until GitHub CI passes, the release SHA matches, the NFL_DB migration is applied, and endpoint + scheduled workflow receipts are inspected.

## Production roster-source clarification (2026-10-26)

The first live capture was blocked because the active team-profile sync identifies ordinary healthy roster members as `roster-presence`, not `nfl-official`. Requiring an NFL injury report for every healthy WR would permanently suppress most games: the official report lists injuries, not the entire confirmed starting lineup. In research v1.3, fresh roster-presence now supports *expected depth and usage only*, with `EXPECTED_ROSTER_NOT_GAME_DAY_CONFIRMED` in the result. A roster-presence `OUT` never becomes a verified loss; injury penalties still require a fresh trusted official/licensed injury report. These scores remain provisional, cannot authorize bets, and need confirmed inactive-list verification before higher-confidence uses.
