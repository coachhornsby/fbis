# FBIS NFL/CFB — SDV post-grade integrity and independent prospective evidence

## Current evidence (2026-10-23, research only)

The football prospective research system has successfully frozen 12 NFL baseline receipts, 11 NFL corrected v0.3.1 receipts, and 45 CFB shadow receipts for upcoming games. The original NFL v0.3 cohort (12 receipts) remains preserved but superseded due to kickoff field-start modeling. Official regulation grades remain 0 for all sports at the audit timestamp; no pregame receipt may be graded until the event finishes and a source-verifiable final is observed.

Historical SDV drives and the first prospective receipts are not sufficient to certify projected-win calibration, Brier/log-loss, holdout return or any economic edge. **NFL v1.2 and CFB v2 remain authoritative.**

## The source-correction gap closed in this phase

The lifecycle fix in PR #1655 enforces the correct sequence: immutable forecast capture **before kickoff**, verified SDV final **after kickoff**, grade timestamp **on or after source observation**. PR #1656 adds a deployed API release-version requirement so a premature collector cannot use the previous grader.

This phase introduces a second, read-only post-insert audit for immutable grades. For each official prospectively graded result it checks:

- The source game ID, 64-digit source SHA256 fingerprint, canonical teams, exact official regulation score, and source-observation timestamp still point to a retained verified SDV source row.
- Every other source revision for that same physical game (same sport, teams and kickoff within 30 minutes) agrees with the grade on both score fields. If a source corrects the final score after the grade was written, the audit emits an incident, **without rewriting or erasing the original grade**.
- The receipt date, kickoff, source observation and grade date are in order, the graded event is regulation-only, and neither receipt nor grade grants wager authorization.
- It distinguishes a healthy, verified nonempty grade ledger from **NO_GRADED_PROSPECTIVE_EVIDENCE**. An empty grade table never passes as a calibrated or production-qualified sample.
- More than 2,000 grades explicitly fails closed rather than silently reporting a partial sample. A later paginated ledger could expand this safely after independent acceptance.

The scheduled collector first confirms the deployed API identifies itself as `SDV_FINALS_V3_REVISION_AUDIT`, then captures eligible pregame research versions, attempts official-source grading, reads the post-grade audit, and reads NFL and CFB paired baseline reports. Any result discrepancy or provenance failure aborts the research audit run. It does not promote a model.

## Prospective gates remain closed

The paired evaluation cannot be declared statistically valid until a sufficient *new* sample of games has finished and is graded against original pre-kickoff receipts, with independent probability reliability, signed bias, MAE, and paired uncertainty intervals. Closing-market benchmarking, CLV, ROI and economic performance require contemporaneous quote and execution evidence that is not supplied by the historical SDV database. No receipts, gradients, thresholds or simulation stars can bypass this.
