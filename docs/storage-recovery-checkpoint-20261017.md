# Storage recovery checkpoint — 2026-10-17

## Measured outcome

The 8 GB goal is **not achieved**. Primary D1 started and ended at **10,007,482,368 bytes** (individual database-detail API and query metadata). Physical reclaimed bytes: **0**. Remaining recovery to 8 GB: **2,007,482,368 bytes**. Source rows retired: **0**. No billing upgrades or production D1 mutations were performed by this work.

## Delivered and exercised

- PR #1216 merged at `3e963defcc32648492137904aa4bbabd6d091998`, after CI success. The storage-only job [38998355219](https://github.com/coachhornsby/fbis/actions/runs/38998355219) completed successfully.
- Archived 2,000 frozen RESEARCH rows, original 50 columns and sparse original source rowids 1052–3733. Complete exact record identifiers live in the compressed package, not a contiguous deletion range.
- Compressed archive: **461,343 bytes**, SHA-256 `abd8d59447376b9ddcf31a54fd15b51e94dd02b7250ff54d4765a4795a6ef2c7`. Uncompressed portable JSON: **8,968,377 bytes**. R2 independently downloaded and verified, then full source records rechecked.
- Independent Google Drive file `1dNCsV0zdctr2rgrrBhJFugmao6eW02ZF`, under the private archive root `1UGipxCS-JIBvmVYFoDQqQpf0WBy7wBGV`, independently downloaded, hashed, decompressed and restored into SQLite. All 2,000 rows and 50 fields match.
- Those **Drive-downloaded bytes** generated bounded SQL for rehearsal D1 `1142b60c-6e00-4286-87b8-4edff9de3129`, table `market_research_restore_20261017`. 100 batches independently read back: 2,000 rows, 2,000 distinct IDs, 2,000 distinct observation keys, zero field mismatches, original rowids preserved. No original CFB rehearsal tables changed.
- Exact per-table count queries succeeded for all **279 application tables**. Sum across those sequential measurements: **4,117,926 rows**. This is not a single atomic database snapshot. Internal `_cf_KV` and `sqlite_sequence` excluded. Full counts: `storage-table-counts-20261017.json`.
- Stable IDs for eight Drive archive folders are in `ops/storage-drive-destinations.json`. Root permission metadata showed only the owner's account; files are not publicly shared.

## Fresh inventory and candidate priority

| Priority | Candidate | Measured population | Required qualification |
| --- | --- | ---: | --- |
| 1 | Historical normalized market RESEARCH observations | 497,624 | Remaining archives, complete source/grade/CLV/prospective references, historical reader parity and new release |
| 2 | Raw CFB roster observations through 2025 | 444,615 | Season partitions, archive/restore parity, writer and logical-reference audit; 2004 remains separately prohibited |
| 3 | MLB market projections, 2026-08-27 through 2026-10-15 | 800,525 | Event completion, settlement/grading/backtest dependencies, point-in-time identity and historical readers |
| 4 | Legacy ACTION book observations | 86,888 | Evidence/decision reference audit and complete recovery package |

No cohort is qualified for deletion by this checkpoint. The 2,000-row market package is a recovery qualification, **not** approval to retire records. Exact physical per-table allocation is unavailable; row counts and JSON sizes are not physical reclaim estimates. The candidates have **not** yet demonstrated a combined 2 GB of reclaimable allocation.

First-100-row bounded value-size samples (biased by source order, excluding SQLite/index overhead): raw CFB 1,089.08 bytes/row; MLB projections 358.38; all normalized market observations 1,063.8; ACTION observations 353.3. Do not extrapolate these into certified physical capacity savings.

## Dependencies and protected evidence

The existing repository consumer audit counted 43 runtime references for `normalized_market_observations`; these require classification and reader tests before retirement. Direct linkage table emptiness is insufficient. Market history is also receiving live WS traffic and cannot be treated as an empty cold-only destination: fresh measurement **818,233,344 bytes**, predominantly CURRENT WS observations. No ingestion or live routing was changed here.

The existing immutable 2004 CFB manifest's `retentionReleaseAuthorized: false` remains binding. No release manifest was overwritten or reinterpreted. Canonical CFB identities and roster memberships remain untouched.

## Capacity automation

The daily monitor uses database-detail physical metadata, not the demonstrably stale database-list response. It stores content-addressed R2 measurements and a separate latest pointer, verifies each R2 readback, reports the 70/80/85/90/95/100 percent levels and computes a two-point growth estimate when prior measurements exist. A critical measurement exits nonzero **after saving evidence**, using GitHub failed-run notification as the operator alert. No automatic deletion, acquisition throttling, or unrelated feed changes.

Automatic Drive synchronization remains **unconfigured**. Connected interactive Drive access is not an unattended GitHub credential. No OAuth tokens were extracted into repository secrets. Archive creation is currently the bounded manually triggered/merge-triggered job, not full recurring historical coverage. R2 manifests must continue to record pending Drive verification honestly until receipts reconcile it.

## Cost and continuity limits

Cloudflare billing-history access returned authentication error. Actual monthly charges and account-wide metered R2/Workers usage are **not verified**; the approximately $10/month goal is not a hard billing cap. No paid upgrades were purchased.

The attached FBIS ZIP passed its compressed-data CRC test and contains older local code/documents/data; it is not a current full-production D1 backup. Do not use it to justify retirement.

## Next release gates

1. Finish reader/dependency classification, then implement storage-only historical fallback with dual-read parity and rollback.
2. Extend content-addressed exports to the larger qualified cohorts; preserve exact schemas, IDs and complete original values.
3. Reconcile R2 and Drive backups and full remote recovery evidence for each frozen cohort.
4. Produce a new auditable release package and obtain separate explicit operator approval for its exact identifiers.
5. Only then retire approved records in bounded batches and measure physical bytes. Stop on parity failure or absent physical reclamation.

No request for deletion approval is made now: historical-reader parity and larger-cohort recovery are not yet qualified.
