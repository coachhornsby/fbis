# R2 batch manifest idempotency repair

The CFB three-part writer, CFB continuation writer, and three-object market writer
previously embedded run-specific `created_verified` / `existing_verified` object
receipts in content-addressed manifests. A rerun could therefore produce another
manifest for identical source bytes and Drive IDs, breaking audits that require
exactly one manifest per batch prefix.

The writers now keep operational statuses in their printed run receipts, but omit
them from newly created manifests. Before any manifest upload, they query only the
batch's existing catalog prefix. A single legacy manifest is reused unchanged only
when its filename matches its downloaded SHA-256 and all manifest content matches
except the two recognized object receipt status values. Source identity, bytes,
checksums, Drive IDs, record counts, contract, and authority flags still must match.
The independent object download and restoration checks in each writer remain intact.

Multiple matching manifests, pagination, metadata mismatch, checksum mismatch, or
changed batch contents stop execution without creating a replacement manifest.
Existing manifests are neither rewritten nor deleted. Existing workflow concurrency
groups must remain enabled: this helper does not claim cross-process transactional
uniqueness against external simultaneous writers. The bounded listing uses at most
100 metadata results and refuses an incomplete result set.

## Offline verification

- `python -m unittest discover -s test -p 'test_archive*.py' -v`
- `python -m py_compile scripts/archive_manifest.py scripts/fbis_drive_archive_r2_continuation.py scripts/fbis_drive_archive_r2_multifile.py scripts/fbis_drive_archive_market_r2.py`
- `git diff --check`

Tests use a fake Drive with no authentication or network operations. They cover
first/repeated writes, mixed-status legacy reuse without replacement, changed
checksums/IDs/bytes/authority, duplicates, pagination, corruption, metadata mismatch,
unknown statuses, and integration in all three writers. No live archive workflow
has been rerun to validate this repair. No Cloudflare queries or production/source
mutations were performed. An already duplicated catalog requires a separately
reviewed recovery decision; this repair deliberately does not select or delete one.
