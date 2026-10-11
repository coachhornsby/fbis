# FBS 0099 production release preflight — STOP until independently reviewed

Scope: immutable, research-only 2026 FBS team and player box-score ledger tables.
PR chain: #942 (0098 college persistence) → #945 (0099 statistics) → #941/#944 (read-only Team Pages + normalized SDV source intake) → separate verified importer.

## Verified current database baseline

- Account: `2fdc80b8d99070adcef12f7a785c3fc1`
- Production D1 UUID: `b50c724c-903b-4241-8ce1-48d931e7a44c`; name `fbis`
- Migration ledgers agree on tip `0097_apify_acquisition_authority`.
- Expected five 0098 tables and all four 0099 tables are absent.
- Active canonical FBS teams: 138; existing research-only roster players cannot be promoted implicitly.
- D1 Time Travel bookmark observed: `0000097a-0001ea6c-00005101-e1ed23dd922ad48188492e60d734888b`.
- Schema-only SQL export completed against bookmark `0000097a-0001f5e6-00005101-f51a796478ff961a26becc2dc571edeb`.
- **Neither bookmark nor schema-only export constitutes a verified full backup or tested restore**. At inspection the D1 database was ~6.4 GB. Obtain independently verified full-recovery readiness before any production write.

## Staged source contract

The GitHub Actions source QA artifact from run 38099918732, artifact 11686129678 contains:
- 745 immutable FBS team-game records, 138 partial team-season records
- 26,620 FBS player-game records, 7,821 partial player-season records
- all source first-observation timestamps treated as 2026-10-11T00:53:00Z; upstream per-row publication times unavailable
- all four tables: `can_influence_projection=0` and retrospective research-only.
- isolated SQLite rehearsal: 35,324 row inserts; duplicate rejection, row hashes and record totals passed.
- partial canonical player-to-2026-team membership QA sampled 50 across 50 teams, all matches; **full 7,821-player reconciliation is still required**.
- no automatic import is authorized by table creation alone.

## Required operator release order

1. Reverify HEAD/Pages SHA, current D1 dual-ledger tips, pending Wrangler migrations, independent PR complete-diff review and accepted exact-head CI. Stop on any drift.
2. Secure **verified full backup/recovery readiness**, retain recovery bookmark and original schema hashes off-platform, confirm and dry-run restoration to an isolated database without changing production.
3. Obtain independent approval and stage #942; apply *only reviewed 0098* to exact D1 UUID. Verify five table/index contracts, old table counts/hashes, migration ledgers and healthy release.
4. Obtain independent approval and stage #945; apply *only reviewed 0099*. Verify four table/index contracts, SQL CHECK authority constraints, rerun and failure/conflict behavior. Keep source and model consumers disabled.
5. Review and release compatible #941/#944 code after 0098/0099 preflight. Verify FBS-only API, complete mobile/desktop browser acceptance and safe unavailable data handling.
6. Validate **every** source athlete/team/year against canonical 2026 roster memberships using exact provider IDs, identify transfers and ambiguous player IDs, archive rejections.
7. Qualify an idempotent bounded import runner and asset hashes. Re-run complete 35,324-row rehearsal with the exact binary, batch size and source manifests. Import postgame research-only records in controlled batches; verify each batch's row counts/content hashes. Never backdate `source_timestamp`.
8. Postflight: compare full table counts (745, 138, 26620, 7821) and control totals, source/observation timestamps, zero non-FBS team IDs, zero model authority, zero new paid CFBD calls and unchanged scoring output. Test real Team Page/stat drilldowns.
9. Keep frozen pregame snapshots and wagering/probability authority **unchanged**. Incremental collector and model reader switch are subsequent, separately qualified work.

## Rollback policy

Prefer reverting code while retaining additive evidence tables and import provenance. Never delete historical statistics or drop new tables as a casual rollback. Whole-production Time Travel restoration would overwrite unrelated new activity and needs separate incident authorization and preservation of interim writes.

## STOP criteria

Missing/failed reviewer acceptance, backup rehearsal, mismatched migration contract, unexpected pending migrations, cross-team player identity problems, source hash mismatch, incorrect partial-season normalization, bad source timing, accidental live-model influence, or unexplained D1 import behavior. Operator approval to *continue* is not evidence these independent technical gates passed.
