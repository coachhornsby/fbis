# Offline Drive adapter and archive contract

Status: implemented and offline-tested only. This module does not deploy a
caller, configure credentials, create folders, certify the archive job, expand
budget policy, or run a live copy.

`services/archive/driveArchiveSink.mjs` implements the `saveImmutable` / `read`
interface used by the known-key archive library. A future approved caller must
provide an authenticated fetch implementation and verified IDs for two existing
folders. No OAuth refresh flow, tokens, environment variables, or secret storage
are implemented here.

## Destination identity and immutable writes

The root is pinned to the existing FBIS_Data Drive ID. Before file lookup or
creation, bounded metadata reads verify this ancestry:

- FBIS_Data
- 04_Model_Evidence
- Known_Key_Archive

Each folder must have the expected ID, name, MIME type, non-trashed status, and
single expected parent (except the pinned root). No folder is created by this
adapter. The destination must be provisioned and approved separately.

Uploads accept only `object-<sha256>.json` / `manifest-<sha256>.json` names whose
hash matches a snapshotted byte payload. Exact-name lookup is restricted to the
verified destination folder, asks for at most two records, and rejects duplicate
matches or pagination. Existing files must match parent, name, MIME type and
non-trashed metadata, then match every original byte. New files are multipart
creates, never updates. Their metadata and independent byte readback must match
before a successful receipt is returned.

Only IDs discovered or created by that adapter instance can be downloaded. Every
read rechecks scoped metadata and enforces the supplied cap. The archive library
then independently downloads and validates its manifest and referenced envelopes,
source SHA-256, original bytes, format, and direct record counts. Provenance
manifests remain zero-record documents, without reference traversal or restoration
claims for their referenced segments.

## Bounded IO and errors

Each adapter instance has hard code ceilings:

- 24 total Drive HTTP requests, no automatic retries or pagination.
- 2 MiB combined uploaded multipart bytes and downloaded response bytes.
- 16 KiB maximum metadata response and 352 KiB maximum file payload/read.
- 110 seconds overall, with each HTTP request limited to at most 20 seconds and
  remaining overall time. Streaming checks the deadline before and after reads.

The two-object near-400-KiB source fixture completes in 21 Drive calls and below
the aggregate byte ceiling, including creation readback and independent recovery.
These are IO bounds, not account-wide billing evidence or production CPU
certification. Cloudflare R2 HEAD/GET admission remains enforced separately by the
existing archive library; this adapter makes no Cloudflare request.

Requests use only fixed Google Drive metadata/media/upload endpoints, manual
redirect handling, GET for reads and POST for create. Redirects and non-success
status codes fail closed. Truncated, oversized, or malformed responses close the
adapter. No raw Google error body is surfaced.

All POST transport, HTTP, truncated-body, or invalid-JSON failures are classified
as uncertain upload outcomes. Other failures after create, including metadata or
readback mismatch, also must not be interpreted as proof that no file exists.
There is no blind retry. A separately admitted later run creates a fresh adapter,
performs exact-name discovery, and reuses any correctly completed upload only
after full byte verification. No cleanup or deletion is attempted.

Concurrent calls on one adapter fail closed. Cross-process Drive list/create is
not atomic: a future caller must provide serialized execution across writers.
Uncertain outcomes must be reconciled before permitting another writer. Duplicate
matches stop instead of selecting or deleting a file.

## Offline verification

`node --test test/drive-archive-sink.test.mjs test/known-key-archive.test.mjs test/job-execution-budget.test.mjs test/account-budget-admission.test.mjs`

Fixtures exercise root/folder scope, immutable create/reuse/collisions, duplicate
and paginated lookup, foreign IDs, moved/type-changed files, error/redirect paths,
stream overflow and cancellation, individual and aggregate IO caps, expiration
during pending response/body, concurrent calls, lost upload response reconciliation,
and complete zero-LIST R2-to-Drive-copy/rerun/readback through the real adapter code.
All transport responses are in-memory fixtures. No production authentication or
network request occurs in these tests.

Remaining live gates: destination provisioning/verification, trusted authentication
wiring and runtime binding identities, writer serialization, current candidate
metadata/hash/provenance and duplicate-coverage checks, CPU/execution certification,
full-account cost evidence, and explicit job admission. The known-key archive job
remains unregistered and denied by the production budget coordinator.
