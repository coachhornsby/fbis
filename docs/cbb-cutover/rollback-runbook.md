# CBB paused rollback and retention procedure

Status: prepared procedure, not a completed production rehearsal or rollback
certification. Do not switch live authority based on this document.

## Preconditions

Record the release SHA, scoped CORE receipt, exact source/target fingerprints,
post-cutover write boundary, and current ownership manifest. Preserve PRIMARY,
CBB_DB, retained target tables and all copy/reconciliation receipts. Never run
PRIMARY-to-CBB shadow sync after SPORT_DB_MODE_CBB=sport.

## Pause and preserve

Keep deployed CBB mode=sport and strict controls enabled. Remove the deployed
CBB receipt pointer through the controlled deployment configuration. Check that
protected collector, research and board requests return explicit unavailable
responses and that no caller writes to PRIMARY. Recheck every scheduled writer;
legacy historical imports must remain disabled. Do not reactivate PRIMARY merely
because CORE or CBB_DB is unavailable.

Capture an independently recoverable archive of CBB_DB and the post-cutover write
set. Record hashes and test archive readback before destructive recovery actions.
No deletion authorization follows from a rollback or successful migration.

## Reverse replay planning

List every new or updated CBB_DB record since the certified cutover boundary,
including mutable records whose original observation timestamp did not change.
Compare full records, not just timestamps or counts. The scope is the 21 declared
research tables and sport=cbb rows of the seven shared working tables. CORE,
shared wager execution, other sports and deferred props retain their owners.

For each source key, classify PRIMARY as absent, identical, CBB-owned changed, or
conflicting. Auto-increment odds/published IDs may collide with another sport's
PRIMARY IDs. A collision is a hard stop: never overwrite that record or invent an
unrecorded remapping. Retain both original records and obtain an explicit identity
recovery contract before replaying a conflict. Preserve model versions, frozen
values, original primary/composite keys, JSON, provenance, restrictions and all
point-in-time timestamps.

Apply only a reviewed, bounded, idempotent replay while writes remain paused.
Commit each page and its durable cursor atomically. Inject a failed page in an
isolated fixture and verify rollback before executing a production recovery.
No live approval may be revoked merely to run a test.

## Validation and authority restoration

Independently compare every replayed key and field, including reverse membership.
Verify both stores remain readable and the archive recovers exact records. Run
model/board A/A, verify other sports remain present, and document all conflicts.
Only after acceptance may a controlled deployment restore PRIMARY authority.
Retain CBB_DB and all old PRIMARY records. Record the actual deployment SHA,
request receipts, write boundaries and post-restoration scheduled-run results.

## Current blockers

The production reverse-replay implementation, numeric-ID collision policy,
isolated end-to-end rollback execution, archive readback and independent acceptance
are not certified. This runbook does not satisfy Phase F or H on its own.

## Implemented isolated recovery primitive and activation fence

`functions/lib/cbbPausedRecovery.js` now provides a paused-only, bounded reverse
replay primitive. It has no HTTP endpoint. SQLite regressions preserve the source,
restore missing CBB rows, keep unrelated PRIMARY rows, and stop on numeric ID or
frozen-model conflicts. It is not a complete production rollback certification.

Before a future approved activation, finish and verify the final shadow delta,
then atomically set CBB_DB `cbb_migration_fence.state='paused'` for id=1 before
changing authority. Every new exact shadow page tests that fence inside the same
transaction as its writes and checkpoint. Verify a shadow copy is denied and
quiesce legacy requests before activating. Never clear this fence simply because
an approval or binding is lost. Reverse replay uses separate paused recovery
controls; route back to PRIMARY only after independent recovery acceptance.
