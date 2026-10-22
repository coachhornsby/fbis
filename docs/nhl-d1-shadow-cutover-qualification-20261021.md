# NHL D1 shadow qualification — 2026-10-21

**Authority:** NHL remains `shadow`, PRIMARY remains authoritative. NFL and CFB remain independently live on sport D1. This phase does NOT change NHL ratings, wager confidence, pricing, or settlement authorization.

## Reconciled live shadow ledger and research tables
The dedicated NHL shard initially lacked four legacy ledger tables: `predictions`, `odds_snapshots`, `team_form`, and `team_form_games`. Versioned additive DDL is in `sql/shards/nhl-v1-ledger-compat.sql` and was applied to NHL D1. Copied existing NHL-only PRIMARY rows insert-only: 178 predictions and 413 odds snapshots, 0 in both team-form tables. No PRIMARY rows deleted.

Also reconciled missing NHL shadow records insert-only: 2 frozen prediction snapshots; 4 NHL team profile snapshots; 4 profile sync runs; 2 deployment observations. A subsequent live count audit matched all 21 working, legacy ledger, and NHL prefix tables.

## Outstanding record-level divergence
Matching table totals are **not full parity**. An 80-ish profile sample showed source-fresher NHL team profiles and goalie profiles, while current NHL observations have differing observed timestamps. The latest 60 frozen-snapshot sample differed in 12 grading/settlement fields and 14 of 60 games had different `updated_at` fields. NHL remains **NO-GO** for authority until a bounded source-authoritative replay passes exact field checks, especially graded snapshots, goalies and team rosters. The new shadow-copy freshness detection forces an idempotent replay when PRIMARY's per-table update watermark is newer, without changing authority.

## NHL shadow checkpoint — October 21, 2026 (subsequent to initial audit)

- Production state: `SPORT_DB_MODE_NHL=shadow`, `NHL_SPORT_DB_MODE=shadow`, no NHL CORE approval. NFL and CFB independently remain in `sport` mode.
- Triggered the 11-sport bounded shadow delta sync through `ops/triggers/sport-delta-sync`; its GitHub workflow completed successfully. No PRIMARY rows were deleted.
- Verified **23 of 23** NHL working/ledger/research table counts matched PRIMARY, including two source-empty NHL tables now added to NHL D1 (`nhl_player_tracking_profiles`, `nhl_replacement_observations`).
- Reconciled a newly created NHL wager-confidence audit row (433 versus 432 to 433/433). Wager validation is **not** inferred from the audit-row count.
- Ran keyed full-row comparisons: all **178 NHL games**, **750 frozen prediction snapshots**, **32 team profiles**, **78 goalie profiles**, and **433 wager-confidence runs** match exactly.
- Audited all **831 NHL player profiles** by `player_key`; 144 source-fresher rows were replayed using an update-only-if-newer primary-key conflict guard. All **831/831** now compare identically.
- PR #1520 merged the NHL tracking/replacement additive schema, included both in prefix sync, and replayed in-place NHL player-profile updates when row totals match.
- PR #1521 merged guarded NHL team-profile GET/sync routing. Shared `player_availability_observations` stays on PRIMARY; sport-owned profiles are routed via `productSportDbHandle`. Shadow keeps working on PRIMARY and strict unapproved sport mode fails closed.
- **Remaining cutover blockers:** inventory and split remaining NHL consumers/writers (goalie-probability shadow, wager research/settlement, canonical evidence, scheduled jobs), verify post-migration deployed bindings and fresh writes, run complete post-cutover recovery rehearsal rather than a one-row no-op, maintain all 11 CORE entries, and obtain an independent NHL CORE cutover receipt before a version-controlled production-only switch.
- NHL **betting-model qualification remains separate and blocked**. Storage parity does not validate NHL-PRO-v2 calibration, goalie starter uncertainty, regulation vs OT/SO, empty-net modeling, or settled profitability.
- **Retention hold:** do not purge NHL, NFL, or CFB legacy PRIMARY rows or legacy market-history D1 merely because sports have shards; archived/retained data must pass documented restore and consumer-coverage gates.

## Next gate
Run the NHL shadow-prefix replay and sport working-table replay after this PR merges and deploys; independently compare full rows by keys, count/freshness, goalie/roster/lineage and settlement consistency. Audit all NHL reader/writer consumers, reject PRIMARY fallback under strict approved NHL authority, demonstrate post-activation reverse replay, and keep CORE all 11 sports complete. Only then stage an NHL-specific CORE receipt, production-only Wrangler flag and independent cutover tests.

NHL model wagering qualification remains separately blocked by the limitations documented in `docs/nhl-production-qualification-20261020.md`, regardless of storage migration results.

## Deletion policy
No source or legacy market-history deletion in this NHL migration. NFL/CFB authority alone is not retention-release evidence. The legacy market-history D1 is nearly full, but Q4 archival and all consumers/restore checks must be independently proven before any bounded cleanup.
