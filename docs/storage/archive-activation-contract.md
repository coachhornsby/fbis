# Zero-LIST archive activation contract

This is a review contract, not an executable deployment or budget policy. The
associated `operations/plans/archive-known-key-activation.json` is explicitly
inactive. Do not import it into the coordinator, turn its flags on, or infer
runtime authorization from a complete plan. No live copy or credential access
expansion is performed by this change.

## Current smallest candidate and unresolved evidence

The plan pins the historical 2,456-byte CFB pilot source manifest and its
content-addressed SHA-256 from `docs/storage-recovery-20261015.md`. A proposed
one-object batch is capped at 4 KiB. It would preserve provenance only, adding
zero restored records. It must not follow any referenced segment keys.

The exact source capture timestamp, provider, and schema version have not been
established. The dated source directory is not a capture timestamp. Do not invent
midnight October 15, use the current time as source capture time, or infer CFBD
from adjacent code. Current source metadata and whether the same manifest is
already preserved in Drive are also unverified. The candidate is not qualified.

First inspect authorized existing Drive/source artifacts and repository evidence.
If complete provenance cannot be established, leave the candidate blocked. Do not
weaken required fields merely to archive it. A separately budget-admitted source
inspection may eventually be needed, but must not be disguised as an unlimited
inventory operation or charged to another job. HEAD is not exempt from admission.

## Destination and folder creation

The existing pinned category is FBIS_Data/04_Model_Evidence. Its ID is recorded
in the plan from read-only Drive evidence. The adapter specifically requires a
separate Known_Key_Archive child with a distinct ID and verified ancestry. That
child has not been provisioned.

The smallest safe destination action after candidate qualification is creation
of that one child, reusing the existing immutable folder helper's exact-name
ambiguity checks and verifying parent/name/type/non-trashed metadata. Reuse an
existing matching child if independently found. Reject duplicates. Do not create
folders before a useful non-duplicate candidate is qualified. Do not set
archiveFolderId equal to categoryId or relax the adapter scope to make it pass.

## Runtime integration gap: two admission domains

The existing Python pilot workflows refer to Google credentials only via encrypted
GitHub Actions secrets. They do not provide Worker-native account-budget RPC.
The new library uses a Worker-native R2 binding and account-budget RPC; the Drive
adapter only accepts an injected authenticated HTTP implementation. It does not
provide authentication, credential retrieval, or a deployment caller.

There is no verified credential-free bridge between those domains. Do not read
secret values into chat or files, copy GitHub secrets to a Worker, mint a token,
add OAuth scope, create a signing service, or expose an endpoint as a routine
implementation detail. Any credential placement or persistent-access expansion
requires the applicable separate security approval. Existing successful Actions
OAuth evidence does not certify a new Worker authentication path.

A future reviewed runtime must establish a concrete authenticated trigger and
verified R2/Drive/account binding identity. No public unauthenticated route, cron,
paid collector restart, model-authority change, or D1 binding is needed or allowed.
If existing credentials cannot be reused within their approved location, report
that blocker instead of silently changing storage or access scope.

## Required unified execution boundary before certification

The library currently admits R2 HEAD/GET units. The Drive adapter independently
caps HTTP requests and bytes, but those local limits are not the coordinator's
execution lease. A deployed Worker also consumes HTTP subrequests and CPU during
Drive operations. This integration must be completed before job certification:

1. Reserve exactly one named archive job through the current coordinator, after
   plan validation and before any R2 or Drive network operation.
2. Validate the grant's job/reservation identity and deadline. Create one immutable
   execution lease. Do not obtain a second lease with a fresh allowance for the
   same admitted grant.
3. Wrap native R2 HEAD/GET and inject that same lease into the authenticated Drive
   transport. Charge every request and actual response byte before releasing it
   to callers; retain adapter upload/combined-transfer caps. Include metadata,
   lookup, creation readback, and independent verification in the request bound.
4. Keep refresh/authentication requests inside their explicit reviewed allowance.
   The current 24-request adapter ceiling excludes any OAuth refresh performed by
   a caller. If that runtime needs refresh requests, separately measure and bound
   them before determining code and policy ceilings. Never hide them in a transport
   callback outside the lease or assume the proposal already covers them.
5. Enforce a one-object 4-KiB source plan for the first qualified candidate rather
   than simply exposing the library's broader two-object limits. Pin expected
   source bytes and SHA and prohibit key traversal/retries.
6. Prove CPU and wall-clock upper bounds for the actual runtime and largest allowed
   document before filling the plan's null CPU/cost fields. IO bounds alone are
   not CPU or dollar certification. Account-wide evidence, already committed costs,
   base subscription and taxes must fit the user's $10 monthly maximum and the
   coordinator's stricter stop policy.
7. Use durable cross-process serialization and persisted reservation/operation
   identity. One sink instance rejects overlap, but Drive list/create is not
   atomic across instances. Never replay an admitted reservation to obtain fresh
   counters. Uncertain upload outcomes require scoped read-only reconciliation
   under a new admitted recovery operation, not a blind create retry.

The proposed R2 units are two reads, 2,456 expected bytes, zero LIST/writes, and
zero D1. The Drive request/response proposal is descriptive only, not certified;
actual authentication/runtime overhead must be included before final approval.
No production job registry or coordinator policy change is included here.

## Offline acceptance tests for the future caller

Before creating a deployment PR, add tests proving:

- No R2 or Drive call on denied, stale, mismatched, expired or duplicate admission.
- Every R2 and Drive operation shares the same non-resettable lease; auth/refresh,
  metadata, upload and independent readback cannot escape accounting.
- First-run plan is exactly one pinned key, at most 4 KiB, zero record credit and
  no referenced-key traversal. Wrong bucket binding fails before source access.
- Destination ID is the verified distinct child, not the parent or another folder.
- Request, response, total transfer, source bytes, deadline and measured CPU ceilings
  fail closed at the boundary, including errors and delayed callbacks.
- Restart/concurrent-trigger races cannot create a second writer or replay a grant.
- Persisted-upload/lost-response recovery discovers and byte-verifies the prior
  file without automatic upload retries or destruction.
- After original and independent download verification, the signed-off receipt
  links run/commit/manifest ID/hash, source bytes, zero direct records, exact unit
  use and restoration scope. Success does not grant deletion or production authority.

The current offline tests validate lower-level components and the inactive plan's
safety shape; they do not satisfy these future deployment gates automatically.

## Ordered next steps and stop points

1. Resolve candidate provenance and duplicate coverage from existing evidence.
2. Select and review a runtime/credential reuse path without access expansion;
   request any required security approval before credential configuration.
3. Implement unified lease/caller and recovery serialization offline; measure CPU
   and authentication overhead; review all acceptance tests.
4. Only for a qualified candidate, provision/verify the dedicated Drive child.
5. Review a separate execution certification and cost-admission change. Obtain
   the specific bounded run authorization and current full-account budget evidence.
6. Execute once, inspect actual logs and immutable independent recovery evidence,
   then update the handoff. If any prerequisite fails, stop the run and continue
   independent offline work. Do not run the existing successful pilots again.
