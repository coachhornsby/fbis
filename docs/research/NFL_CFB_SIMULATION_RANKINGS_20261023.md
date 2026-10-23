# NFL + CFB simulation rankings board — research-only delivery

## Product
New top-level `SIM RANKINGS` route (query `?route=simulation-rankings`) includes NFL/CFB toggle, next 7/14/21 day windows, sort on win %, 14+ blowout, projected total, margin or kickoff, team logos and source provenance. The endpoint `GET /api/football-simulation-rankings?sport=nfl|cfb&week=0..2&sort=winPct&direction=desc` **uses dedicated NFL_DB / CFB_DB only**. Source is always a genuinely frozen pregame score forecast / game-drive simulator receipt. It never reads prices, payouts or places bets.

## Definitions and arithmetic
- One complete game draw yields home score, away score, total, margin, and five event flags: home/away regulation lead, regulation tie, and 14+ point home/away margin. Derived from the SAME scores without any independent outcome generator.
- Percentages are actual counts divided by iterations (NFL 5,000; CFB 1,000), expressed in percent.
- Sort winner by displayed expected higher-scoring team. Scores rounded to one decimal, and **displayed** total and margin are calculated from the rounded scores to avoid contradictory columns.
- Win % means **regulation lead frequency** (NOT final moneyline probability). Tie % separately tracked. NFL overtime, CFB NCAA overtime and settlement conventions are *not modeled*. 14-point blowout means regulation margin >=14.
- Score mean vs lead frequency can differ in skewed outcome distributions. These are descriptive research outputs and cannot authorize wagers.

## NFL generator
`functions/lib/nflFullGameSimulationResearch.js`: `NFL-DRIVE-MC-SHADOW-v1`.
- Plays each 60-minute game as alternating simulated possessions, 8–15 per team, with shared match pace, score-state late urgency and possession-level stochastic scoring. Each of 5,000 game paths simulates all possessions, accumulating actual path scores and outcomes.
- Authentic, PIT-frozen NFL `v1.2` team score forecasts are the team-specific expectation priors, never the market line. Full-game score distribution is **not** the pre-existing Gaussian `pHomeWin` translated into a pretend simulation frequency.
- Until historical NFL possession sources become a verified calibration input, drive rate priors are *explicit structural assumptions*: approximately 11 drives per team and 16% field-goal scoring drives. No fabricated claims that these are measured PBP, position-by-position coverage, or player-level projections. Model `NOT_VALIDATED`; no economic qualification, no snap/injury restoration from post-freeze data.
- Deterministic seed based on model identity / game / authentic frozen baseline. Same source produces reproducible 5,000 paths. Normal NFL production model and wager authorization untouched.

## CFB generator and legacy replay
`functions/lib/cfbDriveSimulationV2.js` uses its existing CFBD-verified historical possession resampler and records the same five game-outcome event counters for **new** simulations.
- Old frozen V2 receipts (Oct 22 cohort) did not store 14+ blowout counts. Do NOT guess them from margin or normal approximation.
- `functions/lib/cfbDriveRankingReplay.js` provides a **separate** research enrichment for each original immutable run in `sql/cfb/0003_cfb_drive_rankings_enrichment.sql`, using the same original `game_id`, `snapshot_id`, `frozen_at`, `kickoff`, `seed`, and point-in-time verified training data. It requires exact original evidence hash, training game and drive counts, simulator RNG seed and previously stored home/away/margin/total/win/tie means. If any differs, it fails and does not insert enrichment.
- No original `cfb_drive_shadow_runs` rows are changed. No post-kickoff source history is smuggled in; original original freeze clock remains the cutoff. Enrichment stores only precise replayed event distributions, evidence hash, version, and no wager authority.
- Operator-only `GET /api/cfb-simulation?mode=ranking-replay-pending` and protected POST `{action:"drive-ranking-replay",runId}`.
- The one-time release-gated `.github/workflows/cfb-rankings-replay-once-20261023.yml` applies additive migration to **CFB_DB**, then replays pending runs sequentially using existing HARVEST_SECRET, records sanitized audit and verifies read-only board. Do not claim success until GitHub Actions and independent sport D1 verification confirm results.

## Safety and readiness gates
- All responses say `RESEARCH_ONLY`, `canAuthorizeWager=false`, `calibrated=false`; the shared ranking contract also sets `canQualify=false` and `changesProductionChampion=false`.
- No modifications to `nflWagerDecision`, CFB publication, betting tracker, or snapshot authority; no probability-to-price comparison in this feature.
- NFL requires measured NFL drive sample preparation, historical and prospective calibration against official regulation results, uncertainty/missingness checks before betting use. CFB Phase 5 already requires >30 verified grades and cannot auto-promote. Win probabilities and blowout probabilities remain uncalibrated research numbers.
- Production route transparently shows `Not captured` instead of inventing a percentage while any replay is missing, and no model odds are fed into wager authorization.

## Tests
`node --test test/football-simulation-rankings.test.js test/cfb-drive-ranking-replay.test.js`
plus existing `test/cfb-drive-simulation-v2.test.js`, navigation/IA contracts, full app build, database binding safety, and release SHA checks. Validate first real NFL + CFB response and the CFB one-time replay completion independently.
