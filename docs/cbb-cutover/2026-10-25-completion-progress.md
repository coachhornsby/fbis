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
