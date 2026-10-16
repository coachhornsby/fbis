# FBIS production storage capacity & retirement gate — 2026-10-16

## Mandate

Keep the primary Cloudflare D1 under its per-database **10,000,000,000-byte (10 GB)** storage limit, preserve exact recoverable source records and prospective evidence, and work toward the user's approximately $10/month Cloudflare cost target. **No Polymarket or PinnOdds feed, websocket, quote, modeling, or market-card changes in this phase.**

## Read-only current baseline

- Primary `fbis` D1 ID `b50c724c-903b-4241-8ce1-48d931e7a44c`: **10,003,816,448 bytes** reported by Cloudflare. Over the nominal per-DB hard limit, no reliable write headroom.
- History shard `fbis-market-history` ID `c32ccf06-c896-4d24-bb89-3e87a7412899`: **143,360 bytes**. Shard creation did not free primary storage.
- Source table `normalized_market_observations`: **667,201** rows including 497,624 `RESEARCH` and 169,577 `CURRENT` rows. Event/source/snapshot query-plan indexes are actively used. Do not remove those to chase space.
- `cfb_roster_observations` 2004 subset: **13,644** source rows, separate `cfb_roster_membership` historical rows **6,822**. Fully archived via 137 SHA-256-verified R2 segments and reconstructed independently as original 27-column table in separate rehearsal D1; original source rows remain in primary.
- Signed fresh operator preflight and D1 Time Travel bookmark preserved as content-addressed R2 `research/storage-recovery/2026-10-16/roster-2004-retention-preflight-5206e1be7a5dbd5b3fb77a39022cf34c8bbb670798aceb24007185b0503fb5d3.json`.

## Formal retention release blocker

The *pinned* content-addressed R2 full-season manifest `research/storage-recovery/cfb-roster-cold-pilot/2004/full-season-manifest-675ad4a9f3cb17a87f09acc577bd40f2e2f8e7e4ea59bf501df14b48b063aa8c.json` explicitly reports:

- `readbackSha256Verified: true`
- `independentD1RecordParity: true`
- `retentionReleaseAuthorized: false`
- `sourceRowsDeleted: 0`

Thus the existing archive **must not** be construed as authorization for a production DELETE. Do not alter the immutable manifest in place. A new separately approved release manifest, complete consumer/foreign-key dependency audit, idempotent tested cohort replay, source row hash lock, rollback check and explicit go/no-go must precede any destructive historical reclamation. No direct D1 row cleanup was performed in this phase.

## Capacity telemetry correction

Cloudflare D1 does not permit the legacy `dbstat`/page-count query on these databases. The new operator-only `GET /api/storage-capacity` uses the actual D1 Workers binding result `meta.size_after` after `SELECT 1 AS healthy`, with no mutations.

Contract:
- Require the existing `x-harvest-secret` **header**, never a query parameter, and always `private, no-store`.
- Return the primary and separate market-history shard actual bytes, percent of each own 10 GB cap, unused headroom clamped at zero, and `PRIMARY_OVER_LIMIT` / `PRIMARY_CRITICAL` classification.
- Reject missing bindings or missing size metadata with 503; do not fabricate account-wide R2 or D1 billing totals or monthly costs.
- No raw lines, source tokens, table contents, or odds are disclosed.
- CI must cover authenticated/anonymous access, precision near 10 GB, missing metadata and complete read-only behavior.

## Next high-impact storage migration

1. Independently audit and sign off read/settlement/CLV/grade consumers of **historical** market ledger rows. Confirm decision-linked/prospective evidence cannot be orphaned.
2. Archive a bounded, eligible source historical cohort into R2 and the market-history shard. Verify every row's original `id`, `observation_key`, all 50 columns, provider observation timestamps, payload hash and canonical rowid. Preserve immutable SHA-256 receipts and **independent source restoration**.
3. Introduce shard-backed archival reads with dual-read parity and operator rollback. Migrate historical consumers while live cards continue their primary read of qualified current prices.
4. Only after the above checks, issue a new retention release and perform small reversible primary-source retirements. Measure physical `file_size` after each; `DELETE` is not proof of capacity relief by itself.
5. Stop and roll back if size does not decrease or if reader parity, provider identity or PIT/capture lineage differs. Do not combine this with the other chat's Polymarket repairs.
6. Verify metered billing through Cloudflare separately. No extra subscription is required solely to create another D1 database, but the user-defined $10/month target is not a hard platform cap.

**Work on general market data collection belongs to the other chat. This track is strictly source retention, size telemetry, verified archival, safe reader migration, and primary D1 space reclamation.**
