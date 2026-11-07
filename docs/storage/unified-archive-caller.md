# Offline unified archive caller

`services/archive/unifiedArchiveCaller.mjs` closes the component-level accounting
gap without deploying or certifying a job. It is an importable function with no
route, schedule, secret lookup, credential configuration, or live invocation.

The caller validates a one-object, at-most-4-KiB JSON provenance-document plan,
with zero direct records. It accepts a generic validated research-document plan;
it does not itself pin the historical candidate key/hash from the activation plan.
A deployment must bind the concrete qualified source identity before invocation.
It uses `env.FBIS_ARCHIVE`, whose actual deployed bucket
identity still requires review. It snapshots the plan, destination IDs, and
provided authorization header before admission. Provenance validation remains in
the archive library. This code does not qualify the currently incomplete candidate.

## One reservation, one lease

The existing library makes exactly one coordinator reservation and validates its
identity, expiry and exact R2 allowances. Its new optional sink factory receives
the same execution lease, after those checks and before any source IO. A caller
cannot provide both an existing sink and a factory. The unified caller uses only
the factory path and creates exactly one Drive adapter with that lease.

The unified caller also requires exactly 24 admitted HTTP requests and 2 MiB of
response-byte allowance. Native R2 HEAD/GET consume the same lease's R2 read/byte
units. Every Drive metadata/lookup/upload/readback request consumes one request
unit before transport. Streamed response bytes are charged before release. The
adapter retains its smaller per-response, combined upload/download, request and
wall-clock limits. Its HTTP timeout is also capped by the shared lease deadline.
Adapter errors close the shared lease; failed/expired operations cannot keep
using R2 allowance. Responses never include the supplied authorization header.

The returned receipt includes both the shared execution snapshot and the local
Drive IO snapshot. A one-object first-copy fixture accounts for two R2 reads plus
15 Drive HTTP requests, including independent manifest/envelope recovery, with
exact total Drive response bytes. Existing files are verified and reused rather
than replaced.

Legacy standalone adapter tests and the general library's direct-sink interface
remain available for component testing. They do not provide unified production
admission. No deployment may certify those paths in place of this reviewed caller.

## Authentication and replay boundaries remain

A future approved host must explicitly supply a currently authorized short-lived
Bearer header and the platform's single-request fetch primitive. The caller adds
that header only to adapter-generated Google Drive requests. It contains no auth
callback, refresh logic, token persistence, or retry; a 401 stops. No production
credential was read, configured or moved while implementing this function.

Token acquisition is NOT included or authorized by this API. If the deployment
needs an OAuth refresh, it must occur through a separately reviewed, budget-admitted
operation with explicit persistent-access approval where required. Do not hide
refresh or retry requests inside the injected transport. Fixture injection exists
for tests; a production host must bind the real single-request primitive.

The existing coordinator rejects reused reservation IDs and the job remains
uncertified. This does not serialize different reservation IDs across processes.
A durable single-writer/recovery caller, actual bucket/destination identity,
authorized credential reuse, CPU certification, and current account-cost admission
remain required before activation. No attempt was made to bypass any of those gates.
The activation plan's runtime verification flags remain false because fixture tests
are not production deployment verification.

## Offline checks

`node --test test/unified-archive-caller.test.mjs test/drive-archive-sink.test.mjs test/known-key-archive.test.mjs test/job-execution-budget.test.mjs test/account-budget-admission.test.mjs`

Tests cover shared aggregate counters, exact grant bounds, denied/expired/mismatched
and duplicate admission, no IO before successful grant validation, first-run scope,
plan/authorization/destination mutation during admission, one factory/lease only,
shared request/byte exhaustion, and redacted malformed-response errors. Existing
archive, adapter, and local coordinator regressions remain applicable. All source
and Drive transport are offline fixtures; no Cloudflare or Drive operation occurs.
