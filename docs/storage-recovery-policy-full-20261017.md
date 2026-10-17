# Approved recovery policy — full-copy 2026-10-17

**Status:** Operator-directed recovery policy for retirement of verified RESEARCH and CFB 2005–2025 cohorts while the Google Drive *binary* mirror of the 41 archive blocks remains incomplete.

## Why this policy exists

The Google Drive MCP `create_file` path is text-only. Raw binary upload is UTF-8-mangled; a full binary Drive mirror of ~321 MB across 41 tars is not available through the connected interactive Drive grant. Drive **does** hold content-addressed checksums, export summary, verification receipts, restoration-test receipts, and exact-ID manifest summaries under `full-20261017` folders.

This policy explicitly approves independent recovery **without** requiring those 41 tars to also exist as binary objects on Drive, provided all gates below remain true.

## Canonical recovery stack (approved)

| Tier | Location | Role |
| --- | --- | --- |
| 1 | R2 `fbis-archive` prefix `research/storage-recovery/full-20261017/` | Primary content-addressed archive (parts + journal) |
| 2 | Cold D1 `fbis-cold-history-20261017` (`6fad1baf-126f-4ab8-9b80-a7d71637d6d4`) | Independent SQL restore of archived cohorts (~3.28 GB physical) |
| 3 | GitHub Actions artifacts from run [39000566511](https://github.com/coachhornsby/fbis/actions/runs/39000566511) | 41 drive-blocks + `result.json` (SHA-256 verified locally 41/41) |
| 4 | Google Drive manifests/checksums/receipts | Integrity index + operator-readable audit trail (not binary payload) |

## Independent recovery procedure

1. Verify Drive checksums file against local/GH artifact block names and SHA-256.
2. Download R2 parts and/or GH artifact blocks; recompute SHA-256; require full match.
3. Restore via `scripts/storage-restore-part.py` into an isolated SQLite DB; require `fullFieldParity` and `PRAGMA integrity_check = ok`.
4. Optionally read cold D1 tables for the same predicates and compare counts / sampled field parity.
5. Do **not** use primary D1 Time Travel as the sole recovery path for authorized retirement.

## Pre-retirement gates this policy does not waive

- Exact-ID manifests must match production rows for qualifying cohorts.
- Protected cohorts remain on primary: `snapshot_type = 'CURRENT'`, CFB `season = 2004`, live `MARKET_HISTORY_DB` shard.
- Dry-run gated workflow must complete with `completed: true` and no blocking errors.
- APPLY still requires `retentionReleaseAuthorized: true` and matching `releaseId` on the retention package.
- Bounded DELETE batches with physical `file_size` remeasure after each batch; stop if size does not drop after meaningful deletes.

## Explicit non-coverage

- This policy does **not** authorize deleting CFB 2004, CURRENT market rows, or any write against `fbis-market-history`.
- This policy does **not** replace a future service-account binary Drive upload; that remains a desirable hardening item, not a blocker once tiers 1–3 are verified.

## Binding

`recoveryPolicyId`: `fbis-recovery-policy-full-20261017-r2-cold-gh`  
`driveBinaryMirrorRequired`: **false** (superseded by this policy for this export only)  
`retentionReleaseAuthorized`: controlled solely by the retention release package, not by this document alone.
