# NHL D1 shadow qualification — 2026-10-21

**Authority:** NHL remains `shadow`, PRIMARY remains authoritative. NFL and CFB remain independently live on sport D1. This phase does NOT change NHL ratings, wager confidence, pricing, or settlement authorization.

## Reconciled live shadow ledger and research tables
The dedicated NHL shard initially lacked four legacy ledger tables: `predictions`, `odds_snapshots`, `team_form`, and `team_form_games`. Versioned additive DDL is in `sql/shards/nhl-v1-ledger-compat.sql` and was applied to NHL D1. Copied existing NHL-only PRIMARY rows insert-only: 178 predictions and 413 odds snapshots, 0 in both team-form tables. No PRIMARY rows deleted.

Also reconciled missing NHL shadow records insert-only: 2 frozen prediction snapshots; 4 NHL team profile snapshots; 4 profile sync runs; 2 deployment observations. A subsequent live count audit matched all 21 working, legacy ledger, and NHL prefix tables.

## Outstanding record-level divergence
Matching table totals are **not full parity**. An 80-ish profile sample showed source-fresher NHL team profiles and goalie profiles, while current NHL observations have differing observed timestamps. The latest 60 frozen-snapshot sample differed in 12 grading/settlement fields and 14 of 60 games had different `updated_at` fields. NHL remains **NO-GO** for authority until a bounded source-authoritative replay passes exact field checks, especially graded snapshots, goalies and team rosters. The new shadow-copy freshness detection forces an idempotent replay when PRIMARY's per-table update watermark is newer, without changing authority.

## Next gate
Run the NHL shadow-prefix replay and sport working-table replay after this PR merges and deploys; independently compare full rows by keys, count/freshness, goalie/roster/lineage and settlement consistency. Audit all NHL reader/writer consumers, reject PRIMARY fallback under strict approved NHL authority, demonstrate post-activation reverse replay, and keep CORE all 11 sports complete. Only then stage an NHL-specific CORE receipt, production-only Wrangler flag and independent cutover tests.

NHL model wagering qualification remains separately blocked by the limitations documented in `docs/nhl-production-qualification-20261020.md`, regardless of storage migration results.

## Deletion policy
No source or legacy market-history deletion in this NHL migration. NFL/CFB authority alone is not retention-release evidence. The legacy market-history D1 is nearly full, but Q4 archival and all consumers/restore checks must be independently proven before any bounded cleanup.
