# FBIS existing college evidence inventory — November 6, 2026

**Outcome:** authoritative historical *evidence locations* identified. This is a migration inventory, **not** an assertion that live 2026-27 projections or today's game data are complete.

## Reuse before recollection

- CBB: [November 2 provider inventory](../docs/CBB-PROVIDER-INVENTORY-20261102.md), [Drive canonical archive folder](https://drive.google.com/drive/folders/1CXyqj4WA-OF9nY_5Nmp5S0RrM_sRO8sJ), [Drive catalog](https://drive.google.com/drive/folders/15Epk7qIb_k3gxzm5cT9I_PVg2K2wfu4w), and [CBB November 5 coverage sheet](https://docs.google.com/spreadsheets/d/1jv9Va1Z27qeDuc_mWIZs4Q5hr_s9rxBhTZC4JXW7o48/edit).
- CFB: [October 11 SDV coverage manifest](../research/cfb/sdv-20261011/coverage-manifest.json), [138-team model coverage](../research/cfb/sdv-20261011/model-stat-coverage.json), [restoration receipt](../research/cfb/recovery-20261011/independent-reconciliation.json) and [Drive historical research folder](https://drive.google.com/drive/folders/1ENt91M_F5fbSbFQR4iEcSDBvatmJId2V).
- CBB archive provenance: [existing manifest](https://drive.google.com/file/d/1PKZ_OHLpmacIkUNDzRSmqUmZ6qJvECeS/view), and [delivery README](https://drive.google.com/file/d/14cmQI-tgnM6Z9ebLGSvQlEs2iyLLq9Cn/view). These files were identified and their textual contents read; the underlying archives have **not** been rehashed during this audit.

## Evidence ledger

| Family | Existing evidence | Outstanding gate |
|---|---|---|
| Teams | CFB 138/138 FBS; CBB source captures 365 | Old CBB canonical migration had 362 records; reconcile exact IDs |
| Schedule/game | CFB 446 games (Oct 11 capture); CBB 87,756 historic schedule rows transferred | Not proof of Nov 6 current game final-status parity |
| Statistics | CFB 892 team rows and 38,665 player-stat rows (Oct 11) | Check complete current game IDs and boxes; no duplicate full-history backfill |
| Ratings | CFB CORE and CBB KenPom/Torvik 365 teams | CBBD current adjusted returns zero; keep prior distinct; preserve timestamp |
| History | CFB long-history code, restored DB receipts and CBB archives in Drive | Check existing archive files, hashes and source timestamps before migration |

**Important:** the CBB October 26 migration parity receipt reports zero rows for the sport-scoped shared `games` table and 362 canonical teams. It must not be conflated with the later 365-team CBBD/KenPom/Torvik provider roster. It is possible that data resides in different locations or represents a different snapshot; no three-team deletion is assumed.

## Execution boundary

The next operation is **read-only archive verification and exact-ID reconciliation**, not broad provider recollection. Keep legacy Cloudflare production authority frozen; GitHub processing remains shadow until results match source evidence and current schedule/box freshness.

Machine-readable reference: [college-evidence-inventory.json](./college-evidence-inventory.json).
