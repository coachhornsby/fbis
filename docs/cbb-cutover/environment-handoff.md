# CBB execution checkpoint — environment unavailable

The execution workspace became unavailable before the full A–H request finished.
Do not treat this checkpoint, passing tests, or reconciliation as a production
cutover approval.

## Durable completed work

PRs #1749, #1751, #1752, #1753, #1754 and #1756 merged. PR #1756 passed CI and
the CBB contract check before merging as 2b70189ff3104e16eb987712db70168f12a7bf9c.
The live reconciliation run 40264640137 compared 498,293 records across all 28
scoped tables in 521 key/field pages. Its complete receipt is committed.
Artifact 12625619860 ZIP SHA-256:
309fac45888dcd49c772f291346de7136307999a130c64d5bf5462b9be7a4299.

Live target schema repairs preserve old target tables under retained_20261026_*
and performed no PRIMARY record deletion. Four absent working tables were
created from PRIMARY schemas. All 21 research schemas and three lean shared
schemas were restored with retained-copy SQL field checks. Fourteen CBB-only
INSERT/UPDATE triggers are installed in CBB_DB.

Future odds/publication sequences were reserved at 3,000,000,000,000,000 in
CBB_DB only. Both working tables were empty; PRIMARY maxima were 94,266 and 36.
No historical key, PRIMARY row or PRIMARY sequence changed. The receipt is
included here even though the allocator helper and its latest tests remain local.

## Live authority last checked

At 2026-10-26 04:48 UTC, production and preview both remained
SPORT_DB_MODE_CBB=shadow. The production CBB_DB binding is
f00af21e-72b5-4e7c-bb10-b08f2c59dace. CORE had no CBB approval rows.
The observed deployed commit was 8fbeb477f3f83aaf3345d679bef5a127248e1df3;
the newly merged #1756 release had not yet been observed deployed.

Latest scheduled CBB harvest/collection receipts report success with zero games,
projections, writes and finals. These empty runs do not establish populated
production writer or board A/A evidence. Do not fabricate records to pass this gate.

## Local work awaiting recovery/publication

Workspace: /workspace/scratch/c1e1109b4430/fbis
Local branch: migration/cbb-completion-20261025
Last recorded local commit: 5223b8f3
There are additional uncommitted changes after that commit.

These later changes include the auto-ID allocator/test, pre-cache CBB API guards,
private telemetry, preview-branch guards/context propagation, additional
Polymarket fixture and tracker readers, and an authenticated paused-recovery RPC
with source-fence validation. A local combined test run passed 183 tests.
Those later changes were not pushed when the workspace disconnected; the merged
candidate's recorded suite contains 142 tests. Recover and review the local
diff before claiming these changes are deployed. In particular, #1756's public
recovery primitive has no HTTP endpoint; the RPC/source-fence additions are local.

## Remaining acceptance work

Finish the definitive consumer review and future schema-owner policy; agree and
verify the shadow freshness SLA; validate populated production writer and board
A/A behavior; complete release-specific fault/rollback and independent archive
recovery acceptance. Then record the independently scoped CORE receipt,
perform guarded activation and representative post-cutover monitoring.
Keep all PRIMARY history and deletion authorization closed.

No final phase certification, production activation or wager authorization was issued.
