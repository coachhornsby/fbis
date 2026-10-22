# FBIS CFB — Drive-State Simulation V2 (Research-Only)

**Placement**: Existing `fbis-cfb` Cloudflare D1 binding `CFB_DB` only. No parallel application, no additional D1 database or purchased provider.

## Scope delivered
- `functions/lib/cfbDriveSimulationV2.js`: normalize actual CFBD drive events (offense side, chronological drive ID, field start distance, period, plays, scoreboard delta, scoring result); reject incomplete sequences and mismatched CFBD game finals.
- `functions/lib/cfbDriveSimulationStore.js`: immutable verified source-game records, prospective regulation-only drive simulator freeze receipts and separate source-reconciled interval grades. All tables are `CFB_DB`-bound, `research-only`, with zero wager authority.
- `sql/cfb/0002_cfb_drive_shadow.sql`: schema for `cfb_drive_verified_games`, `cfb_drive_shadow_runs`, `cfb_drive_shadow_grades`. **Never** apply through canonical `migrations/*.sql`, which targets the primary `fbis` D1.
- `functions/api/cfb-simulation.js`: authenticated `drive-freeze`, `drive-grade`, and `GET ?mode=drives` research status. The pre-existing header secret is required; no secret in query strings or logs.
- `functions/lib/collegeJobsCore.js`: one *optional* `GET /drives` batch per week of completed games through the existing `cfb-postgame-harvest` scheduled morning job **only**, using `cfbdGet()` with existing shared subscription budgets and receipts; never another network owner. Preview flag disabled. Production flag enabled.
- `test/cfb-drive-simulation-v2.test.js`: deterministic simulation, provenance validation, game-score reconciliation, strict training as-of gating, no primary fallback, authorization.

## Exact research method
- A complete, score-reconciled non-overtime drive sequence from CFBD is the sole game training input. Synthetic/fabricated drives are rejected.
- Source collection timestamp is set at collection time. **Historical material ingested later than a target game's original pregame forecast cannot train that target in retroactive backtests.** This avoids using future-known records and produces slower but defensible prospective qualification.
- Minimum 20 distinct games and 300 drives prior to prospective freeze. The current CFB-FBIS-v2 frozen score projection supplies matchup covariates; previous similar projected games supply empirical number/order of drives. For each possession, a bounded 20-candidate nearest-neighbor search samples historical outcome using field position, quarter and current simulated score difference.
- Samples represent **regulation scoring only**. NCAA overtime is not modeled; no live game totals or moneyline/OT wager probabilities can be inferred. No player involvement or correlated player prop probabilities claimed. It uses empirical drive outcomes; it is not yet a play-by-play generator.
- Initial fixed 1,000 simulation draws for capped CPU. Run time, historical game/drive counts, source fingerprint and interval quantiles are retained for eventual prospective grading. No raw 1,000x drive paths saved in D1.

## Planned acceptance gates
1. Production CFB-only D1 schema installed and verified; primary database schema unchanged.
2. Real source game count/drive count > minimum with score reconciliation. `GET /api/cfb-simulation?mode=drives` must report real figures, not invented samples.
3. `drive-freeze` only accepts CFB-FBIS-v2 frozen *prospective* games after enough source games existed and were ingested; never backfills retroactively across as-of clocks.
4. `drive-grade` only succeeds after verified regulation score from actual CFBD drive source, and quantile coverage is checked on genuine holdouts.
5. Separate evaluation versus existing CFB score/residual champion, NCAA overtime handling, and eventually play/player generation before any promotion.

## Data caveat
Before V2, the CFB D1 database had **zero dedicated play/drive history tables**. This phase deliberately does not mislabel game scores as play-by-play. CFBD /drives source is covered by the already connected provider but entitlement and data completeness must be checked at runtime; quota/provider rejection is reported, not silently bypassed.

## Operator
Run only via the existing secure [CFB simulation operator](https://github.com/coachhornsby/fbis/actions/workflows/cfb-simulation-operator.yml) using `drive-freeze` or `drive-grade` for a known canonical CFB game id. No CRON or uncontrolled historical ingestion.
