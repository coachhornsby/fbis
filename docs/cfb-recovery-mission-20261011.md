# CFB recovery and intelligence mission — engineering evidence

This is a partial implementation and audited recovery package, not a completed production release. No production database writes, merges, deployments, model coefficient changes, paid provider activation or wagering authorization occurred during this work.

## Verified baseline

Read-only Cloudflare and GitHub inspection began against main/Pages `a240d6c604b3ec2a1565e8f98bb69d2afbdc0087`, Pages deployment `bce5b6c0-1414-4147-82e3-ed875c49fcc7`. Production UUID remains `b50c724c-903b-4241-8ce1-48d931e7a44c`; rehearsal UUID `1142b60c-6e00-4286-87b8-4edff9de3129` exists and has a 20,480-byte file. Listing metadata `num_tables=0` is not an actual schema count: a SQL inventory found 267 tables including Cloudflare internal storage.

At 04:14 UTC, main and production Pages had advanced independently to `f54a66db95aed555dc7cea1388c3023640e128c9`, deployment `0567d677-192e-49eb-adb9-71b1a71f6ff4` (successful). This branch preserves that tracker-linkage change. A fresh read-only audit still found both migration ledgers at 0097. Five original persistence tables remain absent. Four 0099 research statistic tables remain absent. CFB pregame feature vectors and HFA games have zero rows. Canonical directory: 901 total teams, 138 active FBS, 152,640 players, 397,958 memberships and 470,584 roster observations. These counts do not prove complete player performance coverage or current participation.

CFB game directory has 1,059 rows; predictions have 3,106 rows (2,211 labeled CFB-FBIS-v2). Dedicated published projections, prospective evidence, normalized market observations, normalized economic grades and shared economic grades have zero CFB rows. Do not interpret these zeros as absence of all odds or projections in legacy storage.

The incumbent artifact is `v2-fitted-a-a-contract2`, using frozen margin A / total A Ridge packages from 2022–2024, production fold3. Its coefficients and authority remain unchanged. A read-only diagnostic selecting the latest nominally pre-kickoff incumbent projection per game found 628 graded games, margin MAE 14.0640 and total MAE 13.0866. This is not an independently qualified prospective cohort: participants, historical kickoff accuracy, immutable feature evidence, decision selection and settlement provenance still need qualification. Repeated snapshots must not count as independent games.

## Recovery evidence

The attached FBIS_Drive_Upload.zip has 237 entries and no SQL exports. SHA-256: `001dae66ec7f4fba8f6e70ec0bc24aae0a5655c92dba96ac9c752b8d6bb29352`. Its basketball home-court material does not enter football modeling.

A newer backup was located through Actions run 38102323436 / artifact 11689381988 and private R2 listing. It is a single-bookmark compressed alternative to the unlocated 603-part export:

- Bookmark: `0000097a-0001f724-00005101-7a338de1ed66762831022ae4224fb28f`.
- SQL bytes: 6,305,195,272; SHA-256 `15825a4af75312b68c54d154246b52d89503d1ee26d456a383dde943f18f1473`.
- Compressed bytes: 935,784,946; SHA-256 `fbee515e2e6f01835cd5b2109caf13bcb2c1b004550e3bef76567340675fb467`.
- Five consecutively named parts, each hash in `research/cfb/recovery-20261011/original-recovery-report.json`.
- Original report restored locally and checked integrity plus a few counts, then rehearsed 0098/0099. It did not reconcile all tables. R2 metadata alone does not verify remote bytes.

The new `cfb-existing-backup-verify.py` reads existing R2 parts, checks every part and reconstructed compressed hash, checks full decompressed SQL bytes/hash, restores a fresh local SQLite target, counts source INSERT tuples, reconciles every table, checks foreign keys/integrity, and rehearses migrations twice. No new production export runs. Source dump syntax outside the accepted grammar stops the drill. The original export creation timestamp is not explicitly recorded; workflow/upload timestamps must not be substituted for it.

Current Cloudflare documentation lists a 5 GB single-file import limit and 10 GB paid database storage limit. This 6.305 GB SQL file cannot be submitted as one `d1 execute` import. A full remote D1 restore still needs a supported statement-boundary partition/import plan and rehearsal. Raw byte chunks of a compressed archive are not SQL import files. Do not run production Time Travel as a rollback without separate incident approval.

## Migration and source work

Draft #957 reconciles #942 (0098), #945 (0099), #941 (Team Pages) and #944 (player normalization) with current main, including package and Board-route conflicts. #927 remains an older open superseded draft; it was not closed or merged.

0098 restores five original tables and four indexes, preserves migration history and verifies contracts. 0099 adds four research-only game/season team/player ledgers. Both remain unapplied in production. Tests validate ordering, reruns, constraints and preservation. Independent reviewer acceptance remains outstanding.

Qualified frozen SDV artifact: run 38099918732, artifact 11686129678, ZIP SHA-256 `84704ab00cfc9dbb803c2ddb0b88ac4cd1c295d75fcffa41f604cef7ae21eadb`. Original staged rows: 35,324. Full identity artifact identifies two unresolved athlete/team pairs, affecting four rows. Admissible frozen import: **35,320** (745 team games; 138 partial team seasons; 26,618 player games; 7,819 partial player seasons).

Two full isolated insertion passes verify exact destination content, immutable IDs/hashes, row counts, no double counting and SQLite integrity. The importer now rejects duplicate IDs and incorrect row hashes, avoids broad INSERT OR IGNORE, verifies every destination batch, checks D1 statement bytes and requires acceptance bound to the exact full-reconciliation report hash. Raw source/observed timing remains retrospective; `source_timestamp` stays NULL. Season-only identity proof is not time-aware transfer verification.

SportsDataverse repository LICENSE is MIT. Preserve its notice. That repository license alone does not establish all downstream provider redistribution rights; provider/source qualification remains a release condition.

## Postgame and card implementation

The merged UI and bounded read-only API support FBS identities, rosters, seasons, schedules and available game/season/player metrics. Empty ledgers display unavailable values. This code has not been deployed or verified in a live browser during this work.

`cfb_postgame_rehearsal.py` is an **offline reference implementation**, not a production collector. It demonstrates durable job state, immutable raw/game/card records, exact provider/canonical joins, time-aware player memberships, participation evidence, FBS/non-FBS games, atomic two-card publication, correction versions, retries, paired-denominator rates, immutable cutoff snapshots and an outbox for cache/model/dependency work. It has 15 passing tests, including a chronological two-game feature sequence and exclusion of data normalized after the decision cutoff. A separate disabled D1/R2 pilot passes eight transaction tests and a local workerd D1/R2 integration: both cards, verified players, NULL metrics, duplicate processing, corrections and rollback. Pointer guards reject concurrent changes before publishing aggregates. The candidate schema is outside automatic migration files; no route or scheduler activates the pilot. Qualified provider adapters, canonical verification implementation, leases, polling/reconciliation, outbox consumers and production freshness/load testing are not complete. Its health query reports pending jobs and missing card pairs; it is not the requested production dashboard.

## Modeling and learning evidence

The supplied historical archive claimed 18,957 final games. Inspection found **188 nonfinal games** (95 cancelled, 93 postponed), including 187 at 0–0 and one cancelled at 7–0. Historical training eligibility previously accepted numeric scores as completion. Builders now require authoritative STATUS_FINAL and remove nonfinal games before rolling histories; the old v3 evaluator also requires final status. The old enriched features and original v3 evaluation need a full corrected rebuild before acceptance.

A new score-only challenger uses numeric provider IDs, separate opponent-adjusted offense/defense effects, regularization, recency weights, monthly chronological training and empirical earlier out-of-sample joint score residuals. It consumes no market inputs for scoring. It uses only final archived games; every fit/calibration cutoff precedes tested games. Its source acquisition times are unknown, so it is **retrospective research**, not historical PIT.

2019–partial 2026 evaluation: 6,420 games. Margin MAE 16.0830, total MAE 13.1054, Brier 0.20060, log loss 0.58608. 80% interval coverage: margin 79.52%, total 80.61%; 95%: margin 94.55%, total 95.03%. Paired historical benchmark MAE: margin 12.1758, total 12.5745. The challenger trails this benchmark and does not justify promotion. Benchmark acquisition/price timing is unverified; no ROI/CLV is computed. The model does not establish a comparison with the incumbent on a common qualified cohort.

Bounded offline learning findings record season/regime errors and hypotheses without changing coefficients. PLAYER adjustments, advanced efficiency challengers, school-specific HFA, prospective shadow capture and production learning integration remain outstanding. PLATFORM LEARNING CANDIDATE: explicit final-status contracts before aggregation; exact immutable destination checks after idempotent imports. Other sports need independent contracts/testing before adopting these changes.

## Deliverable register

| # | Deliverable | Status | Evidence or remaining work |
|---|---|---|---|
| 1 | Production baseline | PARTIAL | Current SHA/Pages, both ledgers, all 928 schema objects and all 266 user-table counts verified; complete workflow/source/operational audit remains incomplete |
| 2 | Full backup manifest | PARTIAL | Newer five-part single-bookmark alternative verified byte-for-byte; original 603 parts and explicit creation time remain unavailable |
| 3 | Full isolated restoration | PARTIAL | Full local SQLite restore: 266 tables, 3,285,588 rows, zero FK errors; remote D1 full import remains unverified |
| 4 | 0098/0099/import artifacts | PARTIAL | Reconciled code and local tests; independent review and production approval outstanding |
| 5 | Persistent team/player statistical database | PARTIAL | Existing identities plus 35,320-row isolated research import; production performance ledgers absent |
| 6 | Automated ingestion/corrections | PARTIAL | Offline reference and isolated D1/R2 pilot tested; production collector/scheduler/adapter absent |
| 7 | Refreshed cards for all active FBS | PARTIAL | All 138 research cards generated and reconciled; eight recent final team sides remain source-pending; production publication blocked |
| 8 | Verified player statistical pages | PARTIAL | UI implemented; live data/browser acceptance pending |
| 9 | Reconciliation/health dashboard | PARTIAL | Machine reconciliation/reference health; production dashboard/alerts incomplete |
| 10 | Team strength/adjustment framework | PARTIAL | Retrospective score-state challenger and ratings; production qualification absent |
| 11 | Historical PIT dataset | PARTIAL | 40 actual legacy pregame feature captures recovered; full upstream PIT qualification remains blocked, qualified samples zero |
| 12 | Incumbent/challenger models | PARTIAL | Incumbent reconstructed by artifact; challenger run; common-cohort incumbent evaluation incomplete |
| 13 | Walk-forward/calibration reports | VERIFIED | Corrected score-state research report generated; independent review pending; no production improvement claim |
| 14 | Prospective shadow pipeline | PARTIAL | 43 real future-game snapshots captured and replayed into isolated workerd/D1; recurring rollout PR #963 awaits approval |
| 15 | Economic qualification framework | PARTIAL | Existing shared framework inspected; CFB evidence/joins absent; measurements NULL |
| 16 | Full end-to-end regression | PARTIAL | 1,475 JS tests, 23 Python tests and local workerd/D1/R2 integration; remote D1/collectors/UI/full-chain tests outstanding |
| 17 | Runbooks/docs | PARTIAL | This report and existing release preflight; full production operations remain unqualified |
| 18 | PR/commits/CI/release gates | PARTIAL | Draft #957; tested code cb477a19 passed exact-head CI/source QA; independent reviewer acceptance outstanding |

## Exact release gates and rollback

Do not approve a general "go ahead" or merge this combined PR as a shortcut. Main CI automatically runs migration sync/apply and deployment. Approval must identify exact operation, database UUID, SQL/source/report hashes and accepted review/CI evidence.

1. **0098 only:** require accepted full restore evidence, current no-conflict preflight, exact SHA-256 of `migrations/0098_college_persistence_recovery.sql`, and current main/Pages evidence. Apply only that file to UUID b50c724c-903b-4241-8ce1-48d931e7a44c. Verify original five table/index contracts, unchanged old ledger timestamps and records. Reconcile Wrangler ledger explicitly with the reviewed synchronization process; do not apply 0099 implicitly. Rollback: stop consumers and preserve additive tables; no DROP or destructive production restore without incident authorization.
2. **0099 only:** separately approve exact SQL hash after live 0098 postflight and independent contract review. Verify four tables/indexes, CHECK authority constraints, correct dual-ledger entry and preservation. Rollback: disable consumers and retain evidence, revert code if deployed; no data deletion.
3. **Frozen source import:** approve exact qualified source manifest, quarantine list, importer SHA and accepted recovery report hash. Dry run, then bounded insert/verify. Acceptance counts 745/138/26618/7819, exact stored content, NULL historical source timestamps, zero model influence. Rollback: stop batches, retain immutable rows and journal; resume idempotently only after resolving failure. Unexpected records stop execution rather than overwrite them.
4. **Code deployment:** approve exact tested commit only after schema/data compatibility and live browser QA. Rollback to known Pages artifact, retaining additive data. Merge/deploy must not run a new unreviewed schema operation.
5. **Production postgame automation:** requires qualified D1 pilot, canonical/source contracts, all-game queue reconciliation, simultaneous correction tests, load/freshness measurements, outbox consumers and nonproduction end-to-end drill. Default disabled until separately approved deployment.
6. **Model promotion:** requires frozen common-cohort chronological testing, player/source availability qualification and prospective economic evidence through existing FBIS standards. No threshold changes, automatic champion replacement or wagering authorization.

No production execution approval is requested yet: recovery acceptance and independent review are incomplete.

## Strict recovery and frozen-source acceptance evidence

Hosted verification run `38110310315` at commit `f1fc6e8f9fd799968be6163874ceeda3c882e467` passed. Artifact `11691544549`, ZIP SHA-256 `95780c2353c9ee8aff516589070f669de005d24054501ddf6591bfb691a08e39`, contains the accepted stricter report in `research/cfb/recovery-20261011/independent-reconciliation.json`. It verifies all five remote part bytes/hashes, full gzip/SQL hashes, 3,286,209 source statements, every table count, schema objects, both original ledgers, zero FK violations and integrity before/after idempotent migration rehearsal. No production mutation occurred. Remote D1 acceptance is explicitly false.

Frozen source coverage includes 432 final FBS-involving games and all 745 expected FBS team sides, with some player records on each. It omits 119 non-FBS opponent sides from the FBS ledger. Presence of player rows does not prove all participants or categories are complete. Two unresolved athlete/team pairs remain quarantined. No full Team Card automation claim follows from this snapshot.

`cfb-d1-import-partition.py` prepares bounded complete-statement files from an accepted report, checks the original full SQL checksum, rejects explicit cross-file transactions and emits an ordered manifest. Three fixture contracts pass. It has not partitioned the full export or imported a remote D1 database; this is preparation, not remote recovery evidence.

## Final live inventory and CI

Read-only live inventory at approximately 04:22 UTC records all 928 schema objects (267 tables, 655 indexes, five views, one trigger) and counts all 266 user tables: 3,290,568 rows. Internal `_cf_KV` cannot be read through D1 API (`SQLITE_AUTH`). Thirty-eight advancing tables account for 4,980 additional rows relative to the frozen source bookmark. Live counts were acquired in separate bounded query batches, not an atomic snapshot; they must never replace bookmark reconciliation. Full definitions/counts are in `live-production-inventory.json`. Full workflow health and coverage still require additional qualification.

Code commit `cb477a19dab1af53fc5449cb67695c74d818b5db` passed CI run 38111036517 and source QA run 38111036537. `ci-evidence.json` links the exact accepted code, independent full-restore run and artifact hash. Evidence-only updates do not change that tested implementation. No independent human technical review has occurred.

## Forward execution checkpoint

Main and production Pages advanced through unrelated PrizePicks PR #962 to `59330eabce92f02050fab485a86cb83fe16e6f51`. CFB qualification remains disabled and the audited production games table still has zero future fixtures. This work made no production changes.

A branch-only read-only capture now produces all 138 FBS research cards, retaining 745 team-games, 26,618 accepted player-games and 7,819 team/player pairs. Two player-game observations remain quarantined. ESPN calendar discovery adds real upcoming fixtures: 43 future shadow forecasts at the observed cutoff, with 27 unconfirmed kickoff times and two non-FBS participants pending. Eight recent final FBS team sides are missing SDV boxes. These gaps appear on the corresponding card versions and new shadow qualification reasons; no complete-current-card claim is made.

Historical snapshot audit recovers 40 captured pregame feature records. Their source provenance is incomplete; fully qualified historical PIT samples remain zero. Original roster-based starter claims are preserved as unverified legacy evidence and excluded from new model inputs. Every new snapshot records source receipts, data/card versions, actual materialization/decision/calculation clocks and a stable input fingerprint. Repeated forecasts are version history, not independent economic opportunities.

The initial validated capture at `17190bb3acb80884babe2b5228384d25f14461c4` passed hosted CI (1,434 tests on the focused main-based branch), capture and strict downloaded-artifact reconciliation. All 43 real snapshots were inserted twice into isolated workerd/D1 alongside one synthetic fixture: exactly 44 immutable snapshots, no duplicate accumulation. Updated engineering branch passes 1,475 local JS tests, 13 forward contracts and the existing Python contracts. Evidence is in `research/cfb/forward-20261011/`; full source evidence remains in authenticated workflow artifacts, not republished here. Preservation beyond artifact retention remains an operator gate.

Focused PR #963 contains no numbered migrations, production routes/UI edits or coefficient changes. It proposes six-hour read-only collection; a separately approved merge also invokes the existing standard Pages release. It does not solve production postgame publication, 15-minute freshness, pricing joins, settlement or economic qualification. Review and approve its exact operation independently of recovery PR #957. The concrete acceptance and rollback artifact is `research/cfb/forward-20261011/rollout-operation.json`; current qualification, ROI and CLV remain unavailable/NULL.

Focused rollout head `d2cda7f9117eacd8abc8cc399e1d34e2222d54bb` passed CI run 38113414566 and hosted capture/reconciliation run 38113410369 (138 cards, 43 unique future-game snapshots, 33 raw/normalized receipt digests verified). Artifact 11692741368 has SHA-256 `87a7b3c3c24a21736fdef487699d3d7aa098cf079191351f59841efd363da277` and expires 2026-11-10T05:01:55Z. Independent human review, billing headroom and recurring activation approval remain outstanding.

Public ESPN calendar evidence also contains 78 observed research prices across 13 upcoming games labelled DraftKings. These are source-hash/cutoff-bound research observations, not eligible executable quotes. ESPN's `close` field is not treated as a verified closing line; bookmaker refresh time, ROI and CLV remain NULL. Moneyline probability differences are research diagnostics only; spread/total probability differences remain unavailable until distributions and push probabilities qualify. No raw provider data is republished in the repository.

Final focused rollout head `d664327f6b5ccb191fb7777f68303d8bcd096feb` passed exact-head CI 38113835251 and capture/reconciliation 38113832636, including 78 unqualified research prices across 13 future games. Artifact 11692219666 SHA-256 is `2370cc58bb1c5f4dd28756af852da243432d45512df2c03bd7034f8f31117a34`, expiring 2026-11-10T05:09:25Z. Production migrations, imports, authority changes and continuous activation remain unapproved.

Closing read-only check: main and production Pages both `9412422396a75041ee93229f41420d4765106392` through unrelated offline PrizePicks PR #964. Both D1 ledgers remain 0097 and future CFB fixture count remains zero. API meta confirms zero writes. The later main delta contains only an unrelated audit script and test; no CFB or migration changes. Approval must recheck current main and validate the combined release through normal CI.
