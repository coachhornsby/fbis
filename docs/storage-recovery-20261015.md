# FBIS Cloudflare storage recovery — 2026-10-15 verified checkpoint

## Scope and safety
- This is an inventory and recovery-gate record. No production purge, R2 deletion, D1 database removal, automatic migration, model change, or wagering-authority change.
- Cloudflare account: verified through connected account tools. FBIS production D1 is `b50c724c-903b-4241-8ce1-48d931e7a44c`.
- Numbers are point-in-time API reports, not verified Cloudflare invoices. Billing usage/history API returned authentication error; never present estimates as invoices.

## Storage observed
| Resource | Bytes | Role |
|---|---:|---|
| `fbis` D1 | 10,000,781,312 | Production, actively bound to FBIS Pages and Polymarket stream |
| `fbis-cfb-full-recovery-20261011-38153970674` D1 | 4,729,311,232 | Incomplete isolated import, not a proven recovery target |
| `fbis-cfb-recovery-rehearsal-20261011` D1 | 20,480 | Earlier empty rehearsal |
| `fbis-cfb-tier3-research` D1 | 286,720 | Active `TIER3_DB` binding on FBIS Pages |
| `fbis-archive` R2 | 21,539,234,646 (5,877 objects) | Canonical/archive objects including retained source backups |

Additional R2 buckets `cougarsdefense-uploads` (9,799,917 bytes) and `dubbaseball-recruiting` (442,643,430 bytes) belong to other projects; do not touch them in FBIS cleanup.

Cloudflare D1 has a per-database maximum of 10 GB. Account-level overage billing is not a way to raise that individual database limit. Actual billable GB-month, free allowance and transient operations must be checked through billing once account permissions permit.

## Existing source backup verification
- R2 keys: `d1-recovery/fbis/0000097a-0001f724-00005101-7a338de1ed66762831022ae4224fb28f/backup.part.0000` through `backup.part.0004`.
- Five parts, total compressed bytes **935,784,946**. Compressed SHA-256: `fbee515e2e6f01835cd5b2109caf13bcb2c1b004550e3bef76567340675fb467`.
- SQL bytes **6,305,195,272**; SHA-256 `15825a4af75312b68c54d154246b52d89503d1ee26d456a383dde943f18f1473`.
- GitHub Actions run [38153970674](https://github.com/coachhornsby/fbis/actions/runs/38153970674) retained `independent-reconciliation.json`, `parts/import-manifest.json` and `remote-journal.json` in artifact `11709586433`.
- Verified local restore: 266 tables, 3,285,588 rows, SQLite integrity `ok`, zero foreign key errors, all table-content hashes reconciled. **This is not a verified remote D1 full restore.**
- The same run started a fresh D1 import of 277 SQL parts: 166 completed; `import-0166.sql` was marked `INGESTING` when the job failed. The target file remained ~4.73 GB. Remote content and parity acceptance are **not achieved**.
- The repository's recovery runbook explicitly bars automatic reuse/deletion of the isolated target. Keep the remote target and archive until a separately approved disposition after independent reconciliation.

## Storage compaction checkpoint
- GitHub Actions run [38776633057](https://github.com/coachhornsby/fbis/actions/runs/38776633057) started at `COMPACTION_START_ROWID=471570`.
- Processed 9,000 additional observations, updated 6,183 compactable rows, reduced stored JSON by 12,546,606 logical bytes, deleted zero rows, and passed one reconstruction check.
- The run stopped with receipt-fetch `ECONNRESET`. Last logged cursor was `509110`. Treat this as a **run-local checkpoint**, not complete coverage of the earlier row range or proof of physically reclaimed D1 storage.
- Some candidates were skipped due to source hash mismatch (`ARCHIVED_OFFER_HASH_MISMATCH`); keep them inline, with no forced compaction.
- Proposed transport fix retries only read-only receipt downloads on transient errors; it does not auto-run migrations, auto-resume or delete rows. Apply only after CI, SHA verification, and a reviewed start cursor.

## Before allowing any destructive cleanup
1. Confirm current Pages and Worker bindings, current production SHA, and no active workflow uses the candidate database.
2. Preserve/download independent reconciliation, remote journal, and R2 backup manifest. Independently verify R2 checksums and local restore acceptance against the exact bookmark.
3. Prove whether the failed remote target can be resumed safely or is disposable. Do not infer recoverability from creation or import counts.
4. For any primary database table selected for R2 archive: establish source+destination row counts, full content hashes, replay/read path, temporal provenance, immutable keys, and absence of active-model/settlement dependencies.
5. Run an isolated import/readback and production-facing read-path test before changing production storage.
6. Independently approve named table/database, exact operation, hashes, rollback and spending impact. No unreviewed DELETE, DROP, VACUUM, or target deletion.
7. Measure post-operation D1 file size and actual billing usage: a reduced JSON payload does not prove disk pages or monthly charges decreased.

## Next controlled delivery
- Merge the audited read-only transport retry only after CI and reviewer check.
- Run compaction from a verified cursor with a bounded row cap; retain before/after evidence, row counts, source reconstitution proof, unchanged market/model evidence, and no deletes.
- Separately design a cold-history D1-to-R2 move behind a disabled rollout gate, with complete reconciliation and tested readback.
