# Storage recovery status — Drive verify & restore (2026-10-17)

## Full-copy run

[Run 39000566511](https://github.com/coachhornsby/fbis/actions/runs/39000566511) **completed successfully**. Primary physical size unchanged at **10,007,482,368** bytes. Cold D1 `6fad1baf-…` measured **3,279,081,472** bytes. Source mutations/deletes: **0**.

| Table | Rows archived | Filter |
| --- | ---: | --- |
| `normalized_market_observations` | 667,201 | `1=1` through upper rowid 667201 |
| `cfb_roster_observations` | 430,971 | seasons 2005–2025 (2004 excluded) |

## Drive verification

Created Drive folders `full-20261017` under:

- `06 — Disaster Recovery` → `1mPT6m3dmBNn4XfCGOZytL1Y8ED5fwb1I`
- `05 — Archive Manifests and Checksums` → `1tUnJzinuWQeGmcE-fxoYmy3WEMTSI3Pm`
- `08 — Restoration Tests` → `1BpgZ3vH5eVetPVhHldrxTWvxAnjb9BVV`

Uploaded export summary, 41-block SHA-256 checksums, and verification/restoration receipts. Re-downloaded pilot archive `1dNCsV0z…` and confirmed SHA-256 `abd8d594…ef2c7`.

**Binary block mirror:** Google Drive MCP `create_file` is text-only; raw binary upload via latin-1 is UTF-8-mangled. Canonical binaries remain GitHub Actions artifacts (41 tars, 320,880,640 bytes, all SHA-256 matched locally) and R2 prefix `research/storage-recovery/full-20261017/`. Full binary Drive media upload needs a service-account / resumable Drive API path.

## Restoration checks

- Local SHA-256: **41/41** blocks match `drive-blocks.json`
- Spot restore: market + CFB parts → full field parity
- Multi-sample: 5 market + 5 CFB parts → **25,000 + 25,000** rows, full field parity, SQLite integrity ok
- Full block-0040 (3 parts): 15,000 market rows restored, integrity ok

## Retention release

Draft package: `docs/storage-retention-release-draft-20261017.json`  
`retentionReleaseAuthorized: **false**` — no production DELETE. Exact full ID lists still pending from R2 parts. Requires separate operator release id before `STORAGE_RETIRE_APPLY`.

## Still open

1. Merge [#1220](https://github.com/coachhornsby/fbis/pull/1220) readers (switch remains default-off)
2. Exact-ID manifests for proposed cohorts
3. Operator retention release authorization
4. Optional: Drive binary media upload credential for 41-block mirror
5. Measure primary ≤8 GB only after authorized bounded retirement

## Exact ID manifests (draft release)

- RESEARCH market observations: **497,624** distinct IDs (summary `docs/market-research-ids-20261017-summary.json`; full gzip in run artifacts / `/opt/cursor/artifacts/`)
- CFB roster 2005–2025: **430,971** distinct IDs (summary `docs/cfb-roster-2005-2025-ids-20261017-summary.json`)
- Season 2004 absent from archived CFB cohort (still separately protected)
- `retentionReleaseAuthorized` remains **false**
