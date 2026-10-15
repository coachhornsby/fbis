# Polymarket source evidence storage

The normalized quote ledger retains price, identity, timestamps and trading authority
columns. Existing immutable R2 page receipts preserve the full provider source.

`polymarket-receipt-v1` removes only `providerMarket.marketSides` from inline
`raw_payload_json`. All other properties, including the selected `providerSide`,
market rules/description, family, period and source clocks stay inline. The embedded
`archiveRef` identifies the receipt and original full-payload SHA-256. The row's
`raw_payload_hash` hashes the compact stored JSON. Observation IDs/keys do not change.

Before compaction the archived offer must hash exactly to the original inline raw
payload. Missing archives, mismatches, derived records or oversize receipts stay
inline. No new objects are uploaded, no provider is called and no rows are deleted.
Future paginated ingestion reuses its already-read receipt to compact before writing.

Authorized POST `/api/polymarket-storage` supports:

- `operation: compact`, ISO `cutoff`, numeric `afterRowid`, `limit` 1–500.
  Defaults to dry-run; only literal `apply: true` writes.
- `operation: restore`, one `observationId`. Validates the compact hash, receipt
  identity and archived source hash before restoring omitted arrays. Full source
  reads remain protected by the existing harvest authorization.

Migration uses bounded keyset scans, compare-and-swap updates and small transactions.
Concurrent source writers cannot be overwritten. Existing semantic readers use only
retained fields. Archive restoration retains any later derivation metadata.

The one-shot GitHub workflow waits for the exact validated Pages SHA, then performs
bounded migration and periodic source reconstruction/hash checks. Its artifact holds
runtime results; do not commit live telemetry to Git. Payload bytes removed are exact
UTF-8 byte differences; they are not a claim of identical reduction in billed file
size. SQLite may reuse freed pages before its reported file size decreases.

Rollback: load an observation through restore, compare current storage digest, and
conditionally restore the original JSON/hash. Scope rollback to the migrated IDs and
check space headroom first. No model, price, gate or timestamp rollback is required.

## Large receipt handling

Historical receipts can exceed 16 MB. Maintenance and restoration stream R2 bodies
through the pinned dependency-free MIT @streamparser/json parser. Only requested
market/outcome objects survive parsing; emitted siblings are released. Reads are
bounded to 128 MiB per receipt and 1,000 matching offers. Two receipt match sets
are cached per request, including missing-object results. No new archive objects
or database indexes are created. The rowid range scan avoids source-index sorting.

A newer maintenance trigger supersedes an older run. This is safe because source
evidence is already archived, every row update uses compare-and-swap, and a new
pass skips compacted records. Production deployment jobs retain their own existing
serialization; only this resumable maintenance workflow cancels obsolete runs.

## One-shot runner

Large historical receipts can exceed Pages CPU budgets even when they fit in
streaming memory. The one-shot workflow runs archive parsing and the unchanged
source-hash proof on its GitHub runner. Authorized `operation: receipt` streams
only allowlisted existing receipt bodies (at most 128 MiB) from R2 without parsing
them in Pages. No public archive access is added.

The runner reads bounded D1 pages through the existing Cloudflare API credential,
updates only payload JSON/hash with compare-and-swap, verifies source restoration,
and records its cutoff and maximum rowid. It uploads no archive objects and deletes
no observations. Its final step rebuilds the two optional normalized-ledger indexes
that may be temporarily removed to bootstrap a full database. Completion requires
both indexes to exist. This is a maintenance runner, not a new recurring service.

The player lookup index stores only non-null canonical player IDs. Equality
lookups for a known player continue to use that index. Rows without a canonical
player remain in the ledger and use the existing event/source indexes.
