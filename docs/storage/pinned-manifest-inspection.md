# Exact-key read-only inspection path: offline implementation

This is a feasible integration into an existing host, not another standalone
copy plan. It remains disabled and unconfigured. No live source request, upload,
credential lookup/configuration, binding change, deployment or policy activation
was performed.

## Existing host and concrete operation

Checked-in `wrangler.orchestrator.toml` already binds `R2_ARCHIVE` to `fbis-archive`
and the shared `FBIS_ACCOUNT_BUDGET` coordinator. The orchestrator already supports
`ORCH_CONTROL_TOKEN`. The new path is:

`POST /api/archive/inspect-pinned-manifest`

It is recognized before the unrelated broad orchestrator-job admission, but has
its own stricter checks. It returns disabled unless
`FBIS_PINNED_INSPECTION_ENABLED` is exactly `true`. That flag is not added to any
configuration. It accepts only an empty POST with no query parameters and the
existing control token as a Bearer header. No body/key input, OAuth/JWKS fallback,
auth refresh, new token, cron, or external-provider request exists.

The separately named inspection job admits one HEAD and conditional GET of exactly:

- Bucket: fbis-archive.
- Key: research/storage-recovery/2026-10-15/cfb-roster-2004-pilot/manifest-9dca1afc000cd6951769f92b74f7c45381f117ac51d995c07caf97f4b4ac2f38.json.
- Expected source bytes: 2,456; reservation/stream ceiling: 4 KiB.
- SHA-256: 9dca1afc000cd6951769f92b74f7c45381f117ac51d995c07caf97f4b4ac2f38.

HEAD must match expected size and supply an ETag. GET is conditional on that ETag;
metadata, streamed length and exact hash must match before bounded JSON-object
content is returned. No referenced object is followed. Returned records restored
are zero; source deletion, production authority and archive creation remain false.
This inspection can establish the unknown manifest fields; it does not create an
archive or establish complete duplicate coverage.

## Conditional code eligibility and account admission

The registry now recognizes this narrowly bounded job. That is code eligibility,
not proof that a live Worker has an enforced CPU ceiling or permission to execute.
The job is absent from all checked-in enabled policy/configuration, and the runtime
flag remains absent. The code policy validator requires:

- Exactly the declared zero-network/zero-LIST/zero-write/zero-D1 units, two R2 reads,
  4 KiB R2 bytes, one successful inspection allowance, and logical coordinator
  envelope of one call/two KV gets/two KV puts.
- Account `inspectionAttempts` ceiling exactly one, plus
  `preAdmissionAttemptCeiling: 1` as the declared single-trigger plan.
- Positive explicit `coordinatorOverheadMicroUsd` in addition to
  `worstCaseMicroUsd`. The admission ledger adds both amounts before applying
  account/cycle dollar stops; overhead is not silently subtracted or refunded.
- `runtimeCpuLimitMs: 10`, which must be verified against an actual provider-enforced
  runtime setting before the policy is approved. The registry's `cpuMs: 10` alone
  is NOT enforcement or measured certification. Current checked-in orchestrator
  config has no such CPU limit. No price estimate or runtime claim is supplied here.

The coordinator makes at most one inspection transaction attempt; automatic
transaction re-execution throws before additional gets/puts. The logical counts
are not claimed to equal provider billable SQL rows or exact dollar charges.
The admitted inspector records this already-executed logical overhead in its lease
receipt before touching R2. Existing jobs retain their previous cost calculation.

**The single-success allowance does not cap all inbound requests.** Repeated
authenticated requests, stale-policy denials, or duplicates still consume Worker
and coordinator resources before rejection. `preAdmissionAttemptCeiling` is a
reviewed trigger declaration, not a magical network rate limiter. No source access
is admitted after the first successful reservation in that policy period, but
rejected requests are not free. Activation therefore requires a bounded trusted
single invocation, rate/ingress controls as appropriate, and provisioned baseline
cost for pre-admission and rejected attempts. This code cannot guarantee a provider
billing cap against arbitrary request volume.

## Offline verification and limits of evidence

Tests exercise disabled/unauthorized/body/query/method rejection with zero source
or admission calls, missing/expired/wrong grants, exact-key enforcement despite
caller-supplied override attempts, size/ETag drift, oversized streams, genuine SHA
mismatch rejection, exact policy gates, additive overhead causing dollar denial,
single-success unit exhaustion, and transaction retry rejection.

The exact pinned source bytes are unavailable in current offline fixtures. Tests
therefore do not fabricate a successful pinned SHA check or claim the source's
schema/provider/timestamp has been recovered. Actual hash-success/content evidence
requires the separately authorized/admitted read. Existing full archive recovery
fixtures remain independent tests, not proof of this source's current contents.

## Deployment feasibility and exact approvals/consequences

No new persistent credential or binding is necessary **if** the deployed
orchestrator actually has the checked-in R2/account bindings and the existing
control token is usable in an already-authorized runner. Verify those facts
read-only first. Checked-in references do not establish live availability.

A reviewed activation would need all of the following concrete changes/actions:

1. Deploy the new account-budget code and orchestrator code to their existing
   resources while leaving the inspection flag disabled. Confirm unrelated broad
   collector jobs and empty cron configuration stay unchanged.
2. Establish a provider-enforced inspection CPU bound. Setting a 10-ms limit on
   the entire existing orchestrator could interrupt other slower routes; inspect
   their dependencies and approve that material operational consequence before
   changing the Worker-wide limit. Do not merely set a policy assertion to 10.
3. Approve a short-lived policy addition for this inspection job with the exact
   source units and one successful inspection ceiling. Fill the source-work and
   coordinator-overhead dollar ceilings from current account evidence and runtime
   measurements. Show their total, period, and effect on the $10/month budget.
   Existing allowances/guards must not be raised or weakened to make it fit.
4. Enable the inspection flag for one specific invocation and use the existing
   control token only where it already resides. No credential values belong in
   chat, logs, source control or this document. Disable the flag after the attempt;
   do not automatically retry any failed or uncertain invocation.
5. Verify actual returned source hash/content/unit receipt and record outcome.
   Qualification is a separate decision using actual captured fields and existing
   duplicate-coverage evidence. No Drive folder or archive upload is part of this run.

Under the mission, routine non-destructive code deployment is authorized, but
this task has not performed these deployment/configuration steps. The parent must
review the actual current bindings, CPU impact, costs and explicit one-read scope
before using that authorization. No live run is implied by merging this PR.

If the host lacks the binding or a usable existing token, stop. Adding/moving a
persistent R2/budget binding, creating a new control token/OAuth grant, or configuring
an existing secret for a new persistent runtime requires a separate action-time
security approval identifying the host, resource/data access, credential purpose,
and exposure risk. Broad mission approval is not a substitute. The preferred
path reuses the existing host/access and avoids any such change.
