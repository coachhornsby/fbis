# FBIS cost incident — 2026-10-27

State: PAUSED. No live restart authorized. Refund submitted by Cloudflare: $212.32, not verified received. Support case 02399191.

## Verified cause

Cloudflare query analytics for October 21–27 independently identifies:

- `fbis-market-history-2026q4` (`e8b0b65d-90a6-4842-8ee7-0f85d75afb4c`): four archive queries consumed about 52.19 billion scanned rows. They originate in `functions/lib/marketHistoryVerifiedArchive.js`: two exact backlog/late counts, a late-arrival sample, and the archival page scan. The archive Worker scheduled every five minutes and the recurring GitHub workflow every five minutes overlapped. The archive lease protected writes, but dry-run diagnostics and late-arrival passes still performed scans.
- `fbis-mlb` (`b188629e-cdf7-49e6-b693-dead80777377`): `INSERT OR REPLACE INTO mlb_market_projections` ran 5,235,292 times in the sampled window. The exact SQL shape matches the generic prefix copier in `sportWorkingCopy.js`. Repeated count-parity checks also read billions of rows. Workflow records are preserved outside the executable workflows directory.
- `fbis-market-history-2026q4b`: observation inserts plus latest-market-state upserts added substantial write amplification. Original observations, market integrity, model authority and historical records are preserved.

Analytics use adaptive datasets and are operational evidence, not an exact reconstruction of the final invoice.

## Containment applied

- All seven FBIS Workers replaced with inert 503/no-op code. Durable Object class identities preserved; stop handlers delete alarms without deleting state.
- All Worker cron schedules empty, re-read after deployment.
- Production Pages direct maintenance deployment `31c5ff95-284b-4b7a-8701-4003f5d46e6d`; all paths return 503 without calling bindings.
- Automatic production and preview builds disabled.
- Existing Access application `*.fbis-myz.pages.dev` has a deny-everyone cost-stop policy. Old preview/production hash URLs cannot reach their application unauthenticated; no deployment history was deleted.
- 318 prior workflow YAMLs moved intact to `.github/paused-workflows`; 99 contained schedules. Emergency cancellation workflow only uses GitHub Actions permissions, never Cloudflare/provider secrets. Removed from the executable workflow directory after its final run.
- Two ChatGPT automations paused; Bryan confirmed nine Gemini tasks paused.
- No D1 tables/rows, R2 archives, model coefficients, wagering gates, or CougarsDefense resources changed.

The CORE workflow run record continued to show in_progress after cancellation, but its only job (122232860147) was independently reported completed successfully. Both normal and force-cancel APIs were invoked; no active job was found in that run.

## Code repair, held offline

- Exact scheduled backlog counts removed; unknown counts are not represented as zero.
- Main archive page now requires a named `(collected_at,id)` index and uses tuple keyset pagination. Missing index fails closed rather than scanning. At most 200 rows/page, two pages/invocation.
- Expensive late-arrival scan/pass disabled explicitly, with no storage access and no retention authorization.
- Generic prefix copy now uses null-safe changed-only UPSERT instead of REPLACE. Updates to changed records remain possible; repeated identical records cause zero writes.
- SQL index build is prepared in `archive-indexes.sql`, NOT applied. Index creation consumes reads/writes; no production migration or backfill is permitted during the freeze.

## Verification and limits

New containment/query-plan tests and affected archival tests pass. SQLite fixture: 100,000 rows; a ten-row cursor seek used 164 VM steps, no temporary sort, and the named index. 1,000 identical replay attempts produced zero changed rows; changed/null/composite-key/rowid cases are tested.

Affected prefix-copy tests pass. The full pre-existing prefix suite has an unrelated failing assertion that all prefix sets exclude props, although the current NBA registry includes them. Reproduced against untouched parent `ed7a949f`; evidence is retained. Do not represent the entire repository suite as green.

14:05–14:10 UTC analytics: zero written rows; 569 read rows across the returned databases, including our two schema-only inspections (53 rows). A later analytics request hit Cloudflare's GraphQL rate budget; a missing/empty recent bucket is NOT treated as final proof of zero activity.

## Restart requirements

No scripts restore schedules or runtime automatically. The maintenance middleware and inert Worker code are the enforced zero-work cutoff. `restart-policy.json` records requirements; it is NOT a running dollar-budget enforcement engine.

Before reopening: Bryan approves a concrete monthly ceiling; implement a shared atomic admission budget across all jobs, concurrent runs and retries; establish measured per-query limits and cached board delivery; replace full-history diagnostics with incrementally maintained summaries; redesign late-arrival recovery with a bounded insertion cursor; verify direct-provider and direct-D1 credentials/alternate branches cannot bypass admission; prove the cutoff in a production-like environment. Do not claim that post-query row accounting or email alerts enforce a hard dollar cap. Fixed-price hosting or a provider-enforced limit is required for a strict financial ceiling.

Cloudflare storage and the Workers paid subscription may continue to bill while data is retained. No zero-dollar billing claim is made. Refund settlement remains external and pending.

## Retained-storage cost and rollback notes

Metadata inventory: 20 databases, 40,868,659,200 bytes. At $0.75 per GB-month after 5 GB included, this implies roughly $26.90/month D1 storage at constant size, plus the $5 Workers plan and tax/other retained-service charges. This is an estimate, not an invoice; billing uses time-weighted storage. Reducing it requires a separately reviewed, lossless archival/retention operation. No database deletion was performed.

Some bundled Worker source responses were truncated by the connector: the stream and orchestrator JSON files are explicitly source excerpts, NOT complete deployable backups. Full unbundled source is retained in Git; prior Cloudflare version IDs are recorded in artifacts/cost-stop/rollbackVersions.json. Never upload a truncated response as a rollback. No old Worker versions or Pages deployments were deleted.

Final source commit removes the emergency cancellation workflow and pauses Dependabot configuration. All previous workflow YAMLs remain recoverable in the paused directory. GitHub showed zero queued runs; the one stale run-level badge had no running jobs. Do not interpret a stale run badge as proof of active compute.
