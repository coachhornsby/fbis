# FBIS football SDV — Prospective outcome grading lifecycle audit

Date: 2026-10-23 (America/Chicago); research-only

## Independently verified current state before this fix
- **NFL**: 12 v0.1 prospective shadow receipts; 11 corrected v0.3.1 prospective shadow receipts; 12 superseded v0.3 receipts (excluded from model qualification).
- **CFB**: 45 v0 prospective shadow receipts, paired to pregame CFB-FBIS-v2 snapshots.
- **Verified graded prospects**: 0 NFL, 0 CFB at the time of the audit. These upcoming kickoffs must finish before official results can exist.
- Verified SDV history in dedicated NFL_DB and CFB_DB. All original and normalized NFL source revisions remain immutable; older records are not rewritten.
- No sports models are promoted; zero source or prospective records can authorize wagers.

## Corrected blocking defect
The original selection condition required
\`frozenAt < kickoff <= gradedAt <= observedAt <= asOf\`.
That chronology is **incorrect**: the official SDV source is observed before our grader executes. Valid evidence must satisfy
\`frozenAt < kickoff < observedAt <= gradedAt <= asOf\`.
Otherwise every legitimate graded result would be discarded by the scoring layer even after the SQL insert succeeds.

## Verification and fail-closed grading behavior
1. Pregame receipt and provider-completed score must share sport, exact canonical home/away team identities and kickoff within 30 minutes. Larger schedule discrepancies require manual source investigation; never silently match a similarly named game.
2. Provider final must have a verified source model, 64-character SHA256 source fingerprint and source-observation timestamp after both kickoff and forecast capture, not in the future.
3. Multiple immutable source revisions for one event must **agree** on both regulation scores. Conflicting revisions cause **zero grade insertions**, and the scheduled audit alerts rather than picking the newest convenient score.
4. A database query selects only *ungraded* receipts with an eligible verified postgame source, avoiding the previous 35-row old-ungraded starvation. Each cycle processes up to 120 receipts; this bound avoids arbitrarily large writes. Separate pending count reports unresolved outcomes.
5. Existing immutable grading schema uses \`INSERT OR IGNORE\` keyed by \`receipt_id\`, preventing duplicate inserts. No source result can alter a frozen projection. Later revised finals are flagged as evidence conflicts before initial insert; a post-insert consistency audit is a further release follow-up.
6. Grades reference the official source fingerprint, source game ID, observation time and exact regulation scores. Zero matches leaves sample N at zero, not a fabricated prospective test.
7. Subsequent comparisons are independent by model: NFL corrected v0.3.1 vs existing v0.1, and CFB challenger vs frozen v2 champion. Superseded NFL v0.3 is never eligible for the v0.3.1 cohort. Reporting samples do not authorize wagers.
8. Source-first SDV collection remains scheduled. Prospective capture/grade follows successful SDV source collection and runs at daily scheduled times; the cycle now checks for source conflicts and reads both paired benchmark endpoints before publishing its research artifact.

## What remains an external dependency
Games must finish, official regulation outcomes must be ingested and source-observation timestamps must be later than each individual pregame receipt. Until those facts exist, independent Brier/log-loss, margin and total MAE, prospective reliability, closing-line value, and economic performance cannot be demonstrated. No manual reconstruction of hypothetical outcomes or replay of the old 2026 holdouts is permitted.
