# FBIS Cloudflare storage recovery — 2026-10-15 verified checkpoint

## Current disposition — 2026-10-15 (supersedes earlier cost/target inventory below)

- **Production D1 `fbis` remains intact**, approximately 10.00 GB and still at its per-database hard capacity boundary. Production D1 history has **not** been deleted, vacuumed, repartitioned, or sharded.
- **Complete historical 2004 CFB roster**: 13,644/13,644 rows in 137 content-addressed R2 objects (25,659,280 bytes), all SHA-256 verified and independently reconciled to every source D1 row. Source rowids remain sparse and preserved. Full manifest `research/storage-recovery/cfb-roster-cold-pilot/2004/full-season-manifest-675ad4a9f3cb17a87f09acc577bd40f2e2f8e7e4ea59bf501df14b48b063aa8c.json`.
- [PR #1166](https://github.com/coachhornsby/fbis/pull/1166) merged with internal SHA-256 verified R2 paging and a header-only, private diagnostic `GET /api/cfb-roster-archive`. No CFB card, odds, wagering, source-acquisition, or model routing was cut over. Its production smoke gate verifies unauthorized 403 and authenticated 200 with zero D1 reads/writes.
- **Failed, isolated 4.73 GB recovery rehearsal target was retired**: `fbis-cfb-full-recovery-20261011-38153970674` / `b6ecec0b-5e2b-4bee-8e7e-ca500028b39b`. It was not used by Pages production/preview or the four deployed Workers; the incomplete import had failed at `import-0166.sql`. The original five R2 backup parts, local 266-table/3,285,588-row recovery evidence and GitHub Actions artifact `11709586433` remain preserved. This is **not** acceptance of remote full restore.
- **Permanent pre-retirement evidence**, verified by SHA-256 and R2 readback: `research/storage-recovery/2026-10-15/failed-cfb-remote-drill/retirement-evidence-c067ecd8091c680b949f0f2577ef442ad83c908f524d608877b9d8746ad4b9cf.json`. Independent disposition is also recorded on [PR #987](https://github.com/coachhornsby/fbis/pull/987).
- D1 paid storage is now approximately 10 GB total, rather than 14.73 GB. At the published rates, approximate ongoing Cloudflare Workers + D1/R2 storage cost falls from **$12.5 to ~$9/month** when usage persists a whole month; actual invoiced charges, read/write/request overages and taxes are not verified. No additional Cloudflare subscription was purchased.
- The user-facing **storage availability problem is not fully resolved**: freeing the unused recovery database lowered account-wide D1 charges but did not raise the 10 GB limit on the production D1. Future cost-controlled capacity work must qualify cold-data consumer dependencies, independent recovery, archival read paths and staged write relief before shrinking or sharding production.

---

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


## Live cold archive pilot — 2026-10-15
- The connected Cloudflare API copied **500** records from `cfb_roster_observations`, season **2004**, into five private R2 objects in `fbis-archive`.
- Source season row count: **13,644**. Only 500 were copied; this does **not** establish complete-season coverage.
- Five SHA-256 hashes were recomputed from downloaded R2 objects and matched the uploaded bytes. Each original 100-row D1 range was reread and matched in full JSON serialization. Source reads are retrospective and do not create prospective evidence.
- Total segment payload bytes: **867,291**; manifest bytes: **2,456**.
- Manifest R2 key: `research/storage-recovery/2026-10-15/cfb-roster-2004-pilot/manifest-9dca1afc000cd6951769f92b74f7c45381f117ac51d995c07caf97f4b4ac2f38.json`.
- Manifest SHA-256: `9dca1afc000cd6951769f92b74f7c45381f117ac51d995c07caf97f4b4ac2f38`.
- Verified: readback for all five segments, source recheck, source DB mutations **zero**, R2 archive objects present.
- Not verified/authorized: live read-path cutover, independent complete-season reconciliation, D1 space reclaimed, production deletion, wagering-model authority, or monthly savings.
- The bounded reusable exporter lives in `scripts/cfb-roster-cold-archive-pilot.mjs`, and its manual workflow defaults to dry-run. It requires an explicit `apply=true` input and caps each invocation at 2,000 rows. Existing R2 objects have content hashes in their keys; it will never delete D1 rows.
- The connected billing-usage API still denied read access. Budget arithmetic remains an estimate rather than a verified invoice.

## Full 2004 CFB roster archive — independently reconciled
- The entire season-2004 `cfb_roster_observations` source population (**13,644 / 13,644 rows**) was copied, without mutation, into **137 content-addressed R2 segments**, totaling **25,659,280 bytes**.
- Each object was SHA-256 checked after the R2 readback, and each archived row was independently compared to the exact original D1 range with all raw fields. Full checks: 13,644 unique source record IDs, ascending rowids with no overlaps, source row-count and bounds unchanged on final independent read.
- D1 source rowids **1 through 79,448** are a sparse time-overlapping keyspace; no claim is made that all integers in this interval belong to the 2004 season.
- Complete-season R2 manifest: `research/storage-recovery/cfb-roster-cold-pilot/2004/full-season-manifest-675ad4a9f3cb17a87f09acc577bd40f2e2f8e7e4ea59bf501df14b48b063aa8c.json`.
- Manifest SHA-256: `675ad4a9f3cb17a87f09acc577bd40f2e2f8e7e4ea59bf501df14b48b063aa8c`; size **40,496 bytes**, verified via independent R2 read.
- The earlier 500-row R2 pilot at `research/storage-recovery/2026-10-15/cfb-roster-2004-pilot/` remains intact and is redundant evidence, not deleted.
- Immutable full-season archives are **retrospective research only**. This is *not* point-in-time source qualification or betting authorization.

### Private readback path and security
- `functions/lib/cfbColdRosterArchive.js` pins the accepted manifest SHA and verifies every requested object's SHA-256, rowid bounds, source season, schema and research-only restrictions before returning results. Reading is paginated to at most **100 rows**.
- `GET /api/cfb-roster-archive?season=2004&afterRowid=0&limit=100` is a **private diagnostic**, requiring the existing `x-harvest-secret` HTTP header. Query-string secrets are **not accepted**. Responses are `private, no-store`; missing or unqualified R2 data fail closed with 503. Other seasons and write methods are rejected.
- This endpoint never changes the live `/api/cfb-teams`, canonical D1 identity or roster membership tables, wager decision logic, model coefficients, or qualifications.
- CI explicitly runs the R2 manifest, content validation, unauthorized-access, failure-path and non-mutation tests.

### Outstanding hard gates
1. The complete season-2004 archive does **not** constitute authorization to delete its D1 copy. Active-read dependency audit, changes to consumer query routes, independent full-DB restore qualification, and a rehearsed rollback must precede any DELETE or schema compaction.
2. The CFB isolated full recovery run failed during part 167 of 277. Its **4.73 GB** remote target remains incomplete and protected; cleanup needs a separate, verified disposition.
3. The source D1 remains at/near the **10 GB maximum**. R2 duplication *increases* archived data, and no bill or byte savings can be attributed to these copies until actual D1 physical storage reduces.
4. No new subscriptions, production row deletes, R2 deletes, or recovery-target deletes are part of this phase.
