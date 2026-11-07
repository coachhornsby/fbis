# Offline known-key archive capability

Status: implemented and fixture-tested, not activated or production-certified.

`services/archive/knownKeyArchive.mjs` is an importable building block, not a
scheduled job, deployed endpoint, CLI, or replacement for the existing verified
pilot writers. It does not contain credentials or construct a Google Drive client.
It has no production caller. The account-budget coordinator rejects its job name
with `JOB_EXECUTION_NOT_CERTIFIED`; no certification or policy entry is added.

## Admission and operation boundary

A caller provides a pinned plan, native R2 binding, existing account-budget binding,
unique reservation ID, and a separately reviewed immutable destination adapter.
The library requests its own job reservation through `requireJobAdmission`; it does
not accept a caller-supplied admission token or use another job's allowance.
A grant must match the job and reservation, reserve exactly two R2 reads per object
(HEAD plus GET), and the sum of expected source bytes. R2 LIST/writes and all D1
units must be explicitly zero. Existing expiration and execution unit controls
wrap every R2 operation. Reservations remain non-refundable on failure.

The current monthly policy's `r2Lists=0` ceiling is preserved. No billing policy,
job certification registry, scheduled collector, or deployment config changes.
Future activation requires separate code certification and a fresh approved
account reservation; an unused dollar balance alone does not authorize execution.

## Data boundary

- Only explicit unique keys under `research/` in `fbis-archive`; no discovery/list.
- At most two objects, 256 KiB each and 400 KiB total source bytes.
- Expected original SHA-256, bytes, format, record count, source capture timestamp,
  sport, provider, season, and schema version are mandatory.
- JSON arrays of records and NDJSON are supported, plus explicit `json-document`
  mode for provenance manifests. Document mode requires a JSON object and exactly
  zero records; referenced keys are never traversed or counted as restored. Other
  source envelopes need separate format review; do not relabel them.
- Every HEAD must match the pinned size and provide an ETag before any GET occurs.
- Each GET is conditional on that ETag and must match metadata, streamed length,
  SHA-256, and record count before any destination write.
- Original bytes are preserved in bounded base64 JSON envelopes. No lossy
  conversion or compression occurs. Envelope and manifest hashes are recorded.
- Recursive sorted-key serialization makes envelope and manifest hashes stable
  across caller property insertion order. Array order remains significant.
- Operational created/reused statuses are outside the immutable manifest.
- Independent destination reads verify manifest/envelope hashes, original bytes,
  parse records (or the zero-record provenance document), and confirm counts
  without re-reading R2. This proves lossless
  record recovery, not production-schema/model compatibility.
- Production authority, source deletion, and retention release remain false.

The destination adapter contract is `saveImmutable(name, Uint8Array)` returning
`{id, status}` and `read(id, maxBytes)` returning a Uint8Array. The adapter must
perform bounded network reads, immutable create-or-byte-verified-reuse, approved
folder scoping, and serialization against duplicate writes. The library also
checks returned caps and checksums. Existing Python Drive archive helpers are not
silently bridged or bypassed. The credential-free adapter in `driveArchiveSink.mjs` is now offline-tested;
see `drive-archive-adapter.md`. It has no live authentication wiring or caller.

## Failure and resume

All preflight/source failures occur before destination writes. If later writes or
readback fail, already created immutable objects remain untouched. A serialized
retry under a fresh reservation reuses identical content-addressed artifacts.
Source or provenance changes produce a different content address; they are not a
continuation of the same recovery proof. Never discard old evidence or infer
source deletion approval. Concurrent external writers are not supported by the
adapter interface alone.

## Verification and next safe step

Run offline:

`node --test test/known-key-archive.test.mjs test/job-execution-budget.test.mjs test/account-budget-admission.test.mjs`

The tests include zero-LIST success, repeat reuse, all-HEAD-first preflight,
admission denial, expired/wrong grants, exact budgets, bad plans, source drift,
stream overflow/truncation, checksum/count failures, independent readback
corruption, and caller-plan mutation. They also assert the job stays uncertified.

No live copy, metadata request, D1 query, Drive mutation, or billing-policy expansion
was performed. Before activation, independently establish a non-overlapping cold
candidate with trusted expected size/hash/count/provenance, review its format,
validate the reviewed adapter in its approved runtime, certify execution and CPU ceilings,
obtain budget admission, and separately approve the bounded run. Do not repeat
already verified pilots just to test this capability.
