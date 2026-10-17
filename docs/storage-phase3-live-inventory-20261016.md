# FBIS storage Phase 3 — live read-only qualification checkpoint (2026-10-16)

## Strict scope
Storage and retention only. No Polymarket/PinnOdds ingestion, WS, live market cards, odds or model modifications. No production DML, DDL, migration or deletion in this checkpoint.

## Independently read from production Cloudflare D1
Primary DB UUID: b50c724c-903b-4241-8ce1-48d931e7a44c.
Queries issued via Cloudflare D1 SQL query API; each successful response reported `changed_db=false`, `rows_written=0`, and `meta.size_after=10007482368` bytes (10.007482368 GB decimal; 7,482,368 bytes above 10 GB per-DB maximum).

| Check | Exact result |
| --- | ---: |
| normalized_market_observations snapshot_type=RESEARCH | 497624 |
| normalized_market_observations snapshot_type=CURRENT | 169577 |
| normalized_market_decision_links total | 0 |
| normalized_market_economic_grades total | 0 |
| RESEARCH rows with can_qualify=1 OR can_authorize_wager=1 OR decision_eligible=1 | 0 |
| RESEARCH rows with nonnull settled_at | 0 |
| cfb_roster_observations season=2004 | 13644 |
| cfb_roster_membership season=2004 | 6822 |

Total normalized market rows represented by these two snapshot types: 667201. No source-row deletion. Earlier storage-only PRs #1202/#1203 are merged and their independent smoke verified; previous primary D1 reading was 10003816448 bytes, 3665920 bytes less than current. This delta cannot on its own identify the cause.

## Schema/dependency findings
- `normalized_market_observations` contains 50 columns, including observation identity, raw payload, source/capture times, market/price, model evaluation, eligibility and settlement.
- `normalized_market_decision_links.observation_id` has a declared foreign key to `normalized_market_observations.id`.
- `normalized_market_economic_grades` contains entry/close observation IDs without a declared FK; its table is currently empty.
- Market event/source/player/snapshot indexes were previously confirmed used by query plans; **retain them**.
- `cfb_roster_observations` archived 2004 source is still governed by immutable manifest `retentionReleaseAuthorized=false`. This remains a hard NO DELETE gate regardless of source parity.
- Empty direct linkage tables and inactive research flags do **not** establish that every live endpoint, analytics consumer, settlement process or canonical evidence link can read from a shard.

## Candidate for the next bounded, non-destructive migration
`normalized_market_observations` where `snapshot_type='RESEARCH'`, after partitioning into small source/time windows and verifying payload sizes, source hashes, identities, canonical references, temporal provenance, R2 and market-history D1 capacity.

### Mandatory staged acceptance tests
1. Search entire current repository for reads/joins on `normalized_market_observations`, observation ID and observation_key (including dynamically composed SQL). Record consumer, route, query predicates, existing live behavior and required archival behavior. Search other DB schemas for logical references, not just declared FKs.
2. Build deterministic manifest for a small, old RESEARCH window. Capture the original *50 columns*, primary key and unique observation_key, hashes, row count and R2 keys; do not rely on approximate row sizes or table counts to claim physical-byte recovery.
3. Copy that window to market-history D1 and R2 with exact read-back SHA256, independent restoration in a rehearsal D1, and query-level old/new parity tests.
4. Add explicit archived-read routing/dual-read parity for every actual historical consumer; current market cards must continue reading the primary. Fail closed on incomplete parity and keep rollback.
5. Document full change-control signoff and new independent retention authorization. Do not overwrite existing signed historical manifests.
6. Only after approval, delete a very small reversible subset, measure D1 physical `meta.size_after` before/after, check all readers and restore capability. Stop if file size does not shrink; SQLite deletion alone may not release physical pages.

## Repeatable low-risk read-only probes
Use each statement separately; avoid expensive multi-statement aggregate jobs on an over-limit DB:

```sql
SELECT COUNT(*) n FROM normalized_market_observations WHERE snapshot_type='RESEARCH';
SELECT COUNT(*) n FROM normalized_market_observations WHERE snapshot_type='CURRENT';
SELECT COUNT(*) n FROM normalized_market_decision_links;
SELECT COUNT(*) n FROM normalized_market_economic_grades;
SELECT COUNT(*) n FROM normalized_market_observations WHERE snapshot_type='RESEARCH' AND (can_qualify=1 OR can_authorize_wager=1 OR decision_eligible=1);
SELECT COUNT(*) n FROM normalized_market_observations WHERE snapshot_type='RESEARCH' AND settled_at IS NOT NULL;
SELECT COUNT(*) n FROM cfb_roster_observations WHERE season=2004;
SELECT COUNT(*) n FROM cfb_roster_membership WHERE season=2004;
```

## Status / authorization
PHASE 3 READ-ONLY CANDIDATE SCOPING: COMPLETE FOR THE LISTED CHECKS.
FULL READER-DEPENDENCY AND ARCHIVE-PARITY QUALIFICATION: NOT COMPLETE.
PHYSICAL SPACE RECLAIMED: 0 bytes demonstrated.
RETENTION RELEASE AUTHORIZED: NO.
NEXT STEP: repository-wide historical consumer audit and bounded archive/shard *copy*; no delete until qualified and separately authorized.
