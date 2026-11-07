# Offline durable archive serialization

The next gate is implemented as an inactive host contract. No Durable Object
binding/migration, endpoint, credential, policy, job certification or live archive
operation is created by this change.

`archiveSerialization.mjs` uses transactional durable storage to commit an
account-wide writer claim before calling external archive work. The active lock
is not keyed by caller-selected batch labels or folders. All invocations must
share one durable coordinator per Cloudflare account; separate actors would not
serialize each other. That host binding still requires deployment review.

`serializedArchiveCaller.mjs` snapshots the source plan and destination, hashes a
canonical intent, and invokes the existing unified caller only after acquiring
the persistent claim. The same operation ID becomes the coordinator reservation
ID. Source/Drive network operations remain subject to the unified budget lease.
The serialization ledger stores no token, source records, or arbitrary error text.
It stores only operation identity, intent hash, phase/times, and a verified manifest
ID/hash on completion. At 10,000 ledger entries it stops; no pruning or deletion is
implemented, and completed IDs remain permanently replay-protected in this ledger.

## State transitions

- No active claim + unseen operation ID: atomically store running claim, operation
  record, and count. Only then invoke the callback outside the transaction.
- Active running/uncertain claim: reject every other operation, including different
  IDs and destinations, before budget admission or external IO.
- Previously seen operation ID: reject replay, even with changed intent.
- Callback returns verified independent-recovery receipt and matching lock owner:
  atomically persist completed receipt and clear the logical active pointer.
- Callback, verification or completion-storage failure: return a sanitized uncertain
  outcome; preserve active claim as uncertain where possible. If that write also
  fails, the original persisted running claim still blocks new work.
- Process interruption while running: the durable running record remains blocking
  after restart. Time alone never releases it.

No TTL takeover, automatic retry, force-unlock, cancellation release, or recovery
mutation API exists. Read-only inspection cannot unlock an operation. This is
intentionally conservative: even budget denial after acquisition leaves a blocked
operation until a separately reviewed recovery determines whether any side effect
occurred. It is safer than guessing from an error string that nothing happened.

A future recovery path must prove the old writer is stopped, obtain fresh bounded
read-only admission, inspect exact immutable destination names/bytes, and persist
a verified outcome before any new writer. The module does not implement that
recovery transition or grant permission to delete/overwrite files. A stalled lock
is a reportable blocker, not permission to manually remove it.

The generic serialization primitive trusts its internal callback's receipt. It is
not a public RPC accepting third-party success claims. The host wrapper obtains
that receipt only from the unified archive function's independent readback.

## Offline verification

Unit tests exercise 30 competing calls, replay with changed intent, sticky failures
across time, process-loss records, ledger limits, invalid receipts, and completion
storage failure. A Miniflare SQLite-backed Durable Object test issues 20 concurrent
calls, verifies exactly one succeeds, restarts the runtime, checks completed-ID
replay denial, induces an uncertain operation, restarts again and verifies all new
writers remain blocked. The test-only Worker entrypoint is generated inside the
test and is not a production deployment.

The full serialized caller fixture also verifies successful source/Drive recovery,
redacted persisted evidence, and no second budget admission or network operation
on replay. All external R2/Drive IO is mocked. Existing archive, adapter, unified
lease, and account coordinator tests remain applicable.

## Actual bounded-archive gates

This removes the offline serialization implementation gap but is not a live-ready
claim. The historical 2,456-byte candidate still lacks proven capture timestamp,
provider and schema; duplicate absence is not established by incomplete searches.
A separately admitted pinned-key source inspection may be needed. Do not repeat
unchanged artifact searches or fabricate provenance to get past qualification.

Actual execution also requires the reviewed one-account coordinator host binding,
qualified concrete key/hash pinning, distinct verified Drive child, authorized
short-lived token acquisition/native fetch, CPU/DO-duration/storage cost bounds,
current full-account budget evidence, and specific job certification/admission.
A real coordinator adds storage/CPU usage: include that measured cost before
activation, rather than treating local fixture success as billing certification.

Serialization storage reads/writes execute before the archive job reservation.
Busy, invalid-replay and denied-budget attempts can therefore consume coordinator
resources even though R2/Drive never run. The eventual host needs an authenticated,
rate-bounded trigger and explicit accounting/allowance for those attempts and
serialization storage/CPU. The archive execution lease alone does not cover them.
Do not certify this callable merely because its source/Drive counters are bounded.
