# CBB remaining cutover work — execution receipt

This supersedes the earlier schema-gap status only where a live repair receipt
records success. It does not certify phases A–H or authorize cutover.

PR #1749 merged as `3401c331bdb1e35d686f4c3fa33691e52b24da8d` after
all four PR workflows passed: CI 40259268205, CBB contract 40259268239,
shared college quota 40259268085, directory Phase B 40259268130.

Live target-only schema preparation on October 25 (Chicago):

- Created missing predictions, odds_snapshots, team_form, team_form_games using
  PRIMARY CREATE TABLE definitions. No PRIMARY mutations.
- Restored exact PRIMARY schema definitions for all 21 research tables and the
  three originally lean shared tables. Old target tables are retained under
  `retained_20261026_<table>`. No retained target or PRIMARY records were deleted.
- Recreated source secondary/unique index contracts with `cutover_` names.
- Atomic replacement copied existing target records into the new definitions.
  Record counts and SQL EXCEPT comparisons against retained copies passed for
  every replaced table. These prove preservation during target schema repair,
  not full parity with PRIMARY. Source/target metadata need another live check.
- State and rotation backfills had progressed to 12,000 records each when their
  schemas were restored. Their remaining source gaps are still uncertified.

New exact CBB copier uses all seven shared working tables plus the 21 research
owners. It preserves source keys, raw fields, nulls, JSON and timestamps; filters
shared rows to sport=cbb; checkpoints each page atomically with its writes; and
restarts completed scans to reconcile in-place updates. It requires deployed
shadow mode and rejects unapproved tables/props and incompatible source schemas.
The independent comparison reads both full ordered record sets and stops on any
field/key mismatch; per-page SHA-256 fingerprints accompany receipts. Empty
shared tables do not establish production writer readiness.

The dedicated main-triggered reconciliation workflow waits for the endpoint,
backfills/replays every declared table and compares every key/field in pages.
It uploads 90-day receipts and never activates routing. A failed or partial
run cannot certify Phase C or E. Scheduled recurring shadow sync also uses the
new exact CBB copier. Legacy PRIMARY-only SQL import jobs now check deployed
CBB shadow authority before remote SQL and refuse after activation.

The college API preserves CBB/CORE context. CBB durable-board reads use the
approved owner and refuse missing approval/binding rather than retry PRIMARY.
CBB product routing fails closed in deployed sport mode even if a strict flag
was omitted. Other sports retain their existing resolver behavior.

53 targeted tests passed, including real SQLite transactions, composite-key
restart, checkpoint failure rollback, equal-count mutable changes, cross-sport
exclusion, reverse membership, exact IDs and source restrictions. Existing
broader generic copier tests have three failures also reproduced against the
unchanged merged baseline; those are not passing acceptance evidence.

Outstanding: definitive call-graph review; all current workflow/scheduler
receipts; complete live reconciliation; model and multi-sport board A/A;
production writer exercise against isolated fixtures; comprehensive fault and
paused reverse-replay rehearsal; independently approved CORE receipt; guarded
live activation; representative post-cutover monitoring and archive readback.
No independent certification or production activation is claimed.

## Live reconciliation attempt and lock recovery

PR #1751 passed all eight PR checks and merged as
`a9bf55a0da5a6d9e366925f003945677282565c3`.
The first main reconciliation run, 40263946601, reached the deployed endpoint,
verified the seven empty shared tables, replayed the first three research tables,
and stopped at cbb_players with `D1_ERROR: Currently processing a long-running import.`
The failure receipt is artifact 12624849901; SHA-256 of its ZIP is
`56b45bc0be04b940bece3601c7b06b88cd55dd7dd0e628c24268b58e0cbae5d7`.
No certification was issued.

Bounded retries now record import-lock attempts and resume durable checkpoints.
Permanent schema, record or authority failures remain hard failures. Old historical
population imports require explicit `CBB_HISTORICAL_IMPORT_ENABLED=true` so routine
workflow changes do not unexpectedly launch large PRIMARY imports. These are
historical imports; scheduled guarded collection remains enabled. Recurring CBB
shadow pages receive a larger bounded budget without changing other sports.

The new `live-keys-and-timestamps.json` captures every scoped source/target table:
28 source and 28 target inventories, exact primary-key tuples, record counts,
null/duplicate-key counts and latest timestamp fields. Source tables had zero
null/duplicate primary keys. All seven sport=cbb shared working sets remained empty.
This completes metadata coverage, not the outstanding call-graph or field-parity gates.

## Additional shared-ledger consumer findings

The broader ownership scan now includes generic SQL consumers that do not spell
out CBB by name: 276 candidate files, 64 with direct PRIMARY references and 33
related workflows. Earlier narrower counts did not cover these generic helpers.
These are review candidates, not a definitive accepted call graph.

Direct final-grade/exclusion API requests now carry their already-validated sport
into the store resolver. Manual final lookup uses the scoped snapshot owner while
canonical wager records keep their original environment. Track/strategy contexts
preserve independently approved sport bindings. Game-ID lookups fan out CBB and
remove stale PRIMARY CBB rows; authority loss returns unavailable. Real SQLite
regressions prove no PRIMARY changes during scoped CBB exclusion and preserve
other sports in game-ID readback. 98 related tests passed locally.

## Publication and market identity owners

Further review found publishedProjectionStore still treated CBB as PRIMARY and
basketball market fixture matching replaced only NBA fixture identities. Those
paths now use the fresh CBB owner for CBB publications and fixture IDs. Combined
publication reads remove stale PRIMARY CBB records while preserving existing
NBA/NFL fanout behavior. Market coverage joins scoped CBB fixture IDs in memory
with canonical shared observations; market history is not moved into CBB_DB.
Real SQLite tests preserve frozen publication payloads and untouched PRIMARY rows,
reject revoked CORE approval, and prove cross-store market event coverage.
116 related tests passed locally. This remains routing work, not full certification.

## Exhaustive live record comparison passed

Run 40264640137 completed successfully on October 25 (Chicago). It compared
498,293 source records across all 28 approved tables in 521 ordered pages.
Every page matched all source keys and fields, with equal source/target SHA-256
fingerprints. Raw JSON, source IDs, restrictions and point-in-time timestamps are
included in these comparisons. No copy retries occurred in this successful run.
The source grew during historical population; current complete state/rotation
counts are 155,645 and 33,054 rather than the older 146,172 and 28,332 baseline.

Receipt: `artifacts/cbb-cutover/exhaustive-field-reconciliation.json`.
GitHub artifact 12625619860, 90-day retention, ZIP SHA-256
`309fac45888dcd49c772f291346de7136307999a130c64d5bf5462b9be7a4299`.
This proves scoped data reconciliation; it is not board A/A, independent release
approval, or evidence of a populated production game/projection writer.

All 14 cross-sport INSERT/UPDATE triggers are installed in CBB_DB. They reject
other sports in all seven shared working tables; PRIMARY was not modified by
this operation. CI discovers CBB schema table definitions and fails if a new
research owner is omitted from the copy catalog, accounting for temporary rebuild
renames and the explicitly deferred player-prop table.

Prepared paused reverse replay has no HTTP endpoint. It requires deployed strict
sport mode, no receipt pointer and explicit paused recovery state; it preserves
the source and refuses cross-sport numeric ID collisions, game identity conflicts
and frozen-field changes. A transaction-local migration fence prevents an already
running shadow request from overwriting private data after activation. The fence,
page guard and progress tables are CBB-local migration control metadata, not
PRIMARY-owned research and not model/wager authority. 142 related tests passed.
No live rollback or fault injection against live approvals was run.

Still open: accepted complete consumer/call-graph inventory; future schema-owner
migration enforcement; agreed freshness SLA; full populated board A/A and official
fixture writer evidence; complete release-specific fault/rollback and archive
recovery acceptance; independently scoped CORE approval; guarded live activation;
representative post-cutover monitoring. No A–H final certification is claimed.
