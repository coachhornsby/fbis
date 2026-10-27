# FBIS completion and restart master plan

Prepared for Bryan · 27 October 2026 · Decision baseline: Cloudflare ≤$10/month including tax; automated OpenAI/Gemini API spend $0.

This is the implementation and acceptance plan. Proposed architecture, schedules, thresholds and work packages below are not claims that they have already been deployed. Keep production and all agent tasks paused while completing the prerequisites. Do not restore the old workflow directory or old cron schedules wholesale.

## 1. The finished product

Complete one FBIS platform covering NFL, CFB, CBB, NBA, WNBA, MLB, NHL, soccer, tennis, NPB and KBO. Tennis has separate ATP and WTA views, training cohorts and validation, with one tennis database. Each sport owns its predictions and evidence; shared services handle identity, market contracts, provenance, archives, settlement, costs and presentation.

Every scheduled event must have a card or a specific exclusion reason. Every accessible Kalshi/Polymarket prop must be accounted for, even when FBIS cannot project it. Every projection must identify its model, pregame inputs and timestamp. Every wager/result must link to immutable evidence. The board must display freshness and blockers honestly.

“Fully online” has two meanings that must stay separate:

* Technical completion: all eleven sport pipelines, API contracts, storage paths, board views, recovery and settlement pass their acceptance tests.
* Wagering qualification: a particular model/market cohort passes its registered prospective and economic gates. An operational sport may remain research/shadow or market-only. No invented edge or automatic promotion is needed to call the engineering complete.

The existing frozen champions, model coefficients, thresholds and evidence rules remain authoritative until an explicitly reviewed change meets their gates. No automatic betting is part of this plan.

## 2. Starting point and known blockers

The repository baseline checked for this plan is `coachhornsby/fbis`, remote main `0af3d98c4d8f624b5c277d1591db095f052e649e`. Work must start from a fresh branch of current main while preserving unrelated local work.

Emergency containment already applied: canonical Pages maintenance response, automatic builds disabled, historical Pages hostnames behind Access, seven collector/orchestrator Workers inert, their cron schedules removed, 318 workflow files preserved outside the active workflows directory, and the two identified ChatGPT tasks paused. Bryan has paused the Gemini tasks. These controls must be read back again before any migration or release; they are not perpetual proof of inactivity.

Cloudflare support approved a $212.32 courtesy refund against invoice IN-85819906; receipt in PayPal remains to be confirmed. Support also identified new-period usage already incurred. A refund does not reset usage or remove future storage charges.

The D1 metadata inventory totals approximately 40.87 GB. The three market-history databases alone total about 26.58 GB; primary `fbis` is about 7.43 GB and the cold-history database about 3.29 GB. At the published storage rate, this footprint is incompatible with $10/month, even while collection is stopped. Exact billed GB-months depend on time-weighted storage and billing units.

The expensive paths were repeated full archive/backlog scans and millions of replacement writes/copies. Offline repairs replace selected scans with indexed keyset pages and unchanged-value writes with no-op UPSERTs. Focused tests passed; the archive index has not been applied remotely. The restart-policy file is a requirements document, not an implemented global spending cap. The entire repository has not been certified green.

Existing sport databases are already provisioned. Creating them again is unnecessary. Some consumers still use primary/shadow modes, so “has a D1” does not establish independent ownership. CBB has strong recent reconciliation evidence—498,293 records across 28 tables—but its final consumer audit, fault/recovery tests, approval and activation gates remain open. NHL's documented production qualification remains shadow-only. Tennis source permissions and independent projection coverage have unresolved gates.

## 3. Architecture and ownership

Target path: authorized provider → bounded collector → raw archive/spool → canonical sport records → frozen sport model → projection/evidence → independent market attachment → cached board. Official results feed settlement, calibration and research. Heavy historical analysis reads restored archive files locally or in a deliberately budgeted batch environment, never by repeatedly scanning production D1.

| Component | Owns | Must not become |
|---|---|---|
| Eleven sport D1s | Current fixtures, relevant roster/features, current projections, compact settlement/evidence indexes | Raw response/tick archive or copies of unrelated sports |
| CORE D1 | Cross-provider identities, model registry, global summary and wager/evidence references | Duplicate full sport tables |
| Operations D1 | Compact job leases, checkpoints, counters and incident references | Per-request log warehouse |
| Google Drive | Historical raw data, partitioned history, DB recovery exports, model artifacts and independent verification | Live query engine or public asset CDN |
| R2, if retained | Small current immutable board bundles/assets and short-lived transfer staging | Unbounded history or every WebSocket message |
| Google Sheets tracker | Human-readable ledgers, handoffs, scope, source and release status | Authoritative event DB or high-frequency queue |
| One production dispatcher | Job admission, ownership, budget reservation and bounded execution | LLM orchestration or overlapping cron trees |
| GitHub Actions | Tests, explicit releases, bounded approved batch jobs | Second independent production collector scheduler |
| ChatGPT / Gemini tasks | Read-only interpretation of compact receipts | Reliability engine, hidden paid collector or automatic deployer |

Use explicit ownership routing. After each sport cutover, missing sport bindings fail closed; do not silently fall back to primary `DB`. No production prefix copier or cross-sport write-through. Shared identities are referenced, not replicated indefinitely. Every consumer is inventoried, including Pages functions, Workers, CLI scripts, GitHub workflows, Sheets exports and direct API endpoints.

## 4. Google Drive as a real storage asset

The supplied storage screenshot showed 66.38 GB used out of 5 TB. That is ample capacity for the current roughly 41 GB D1 footprint plus compressed history and backups. Recheck actual available capacity before starting. This uses the existing subscription; it does not require Gemini model API calls.

### Folder and catalog design

Create a private `FBIS_Data` root with the following folders. Store folder/file IDs in a catalog, since Drive names are not unique.

| Folder | Contents |
|---|---|
| `00_Catalog` | Dataset register, schemas, source rights, manifests, partition status, recovery instructions |
| `01_Raw/<provider>/<sport>/<year>/<month>/<day>` | Compressed original provider payloads with fetched-at timestamps |
| `02_Canonical/<sport>/<dataset>/<season>/<month>` | Typed Parquet data; compressed NDJSON for nested contracts/evidence |
| `03_Market_History/<venue>/<sport>/<year>/<month>/<day>` | Contract inventory, rules, quote snapshots and completeness manifests |
| `04_Model_Evidence/<sport>/<model_version>/<run_id>` | Input manifests, model artifacts, predictions, folds, evaluation and approvals |
| `05_DB_Backups/<database>/<snapshot_time>` | SQL/schema exports, export manifests and restore reports |
| `06_Settlement_Ledger/<sport>/<season>` | Append-only result/wager/CLV evidence exports |
| `07_Operations/<year>/<month>` | Daily cost/job summaries, incidents and release receipts |
| `08_Recovery_Tests/<test_id>` | Independent downloads, integrity reports and restore verification |
| `09_Legacy_Imports` | Original ZIP, historical scripts and supplied research documents, preserved without activating them |

Each partition manifest records dataset/version, source, sport, time window, schema version, record count computed during export, min/max keys, byte count, SHA-256, producer SHA, source DB/table, provider rights, Drive file IDs, parent manifest and verification state. Preserve original received-at time separately from event time and corrected-at time. No secrets or API keys in these files.

Prefer immutable daily partitions with a compact manifest index. Avoid millions of tiny files; combine logical batches after verification. Use Parquet for analytics, NDJSON.gz for lossless nested records, and SQL plus schema for database recovery. A compressed data partition alone is not a complete relational backup.

### Permissions and API wiring

1. Use a dedicated private folder, least-privilege OAuth access and a dedicated archive identity/session. Confirm account type before choosing personal Drive versus Shared Drive; do not assume a service account owns usable personal storage.
2. Keep refresh tokens in the runner's secret store, never in Git, Sheets, board JavaScript or raw archives. Public site code gets no Drive credential.
3. Use Drive API v3 `files.create` for folders and resumable binary uploads; `files.get` for metadata/download verification; `files.list` with folder IDs and pagination for bounded reconciliation. Use supported download methods for the file type. Native Docs/Sheets exports are separate from binary archives.
4. Check current Drive API quotas, any linked Google Cloud billing and applicable over-quota terms before bulk transfer. Default to no billable over-quota execution. Rate-limit, honor Retry-After and retain resumable checkpoints.
5. Archive from a local/batch runner with enough scratch disk. Avoid proxying tens of GB through paid Workers. Keep resumable upload sessions and export checkpoints outside the archive being modified.
6. Use append-only archive permissions where practical; separate the backup writer from any deletion permission. Protect against sync clients propagating accidental deletions. Keep a second recovery copy of critical ledgers/model artifacts outside the primary Drive account when available.

### The migration and deletion gate

For each database/table group: inventory schema and dependencies → take consistent bounded export while writers are paused → write original and typed partitions → upload → independently download → check hashes → restore into isolated local SQLite/test storage → check schema, keys, counts, null/type fidelity, representative values, evidence links and settlement reconstruction → issue a signed-off manifest.

Count rows while exporting; do not add recurring full-table COUNT jobs. Keyset pagination requires verified indexes and stable key boundaries. Record late-arrival/correction handling; do not infer completeness solely from maximum timestamp. Any temporary remote index/export writes must be budgeted before execution.

Only after that gate should an explicit reviewed migration remove archived D1 rows or retire an obsolete DB. Start with the large history stores, then primary duplicates and cold-history, then redundant retained/shadow tables. Keep unresolved/live wagers and their evidence available. D1 page allocation may not shrink immediately after row deletion: measure provider-reported billed size; if required, migrate the compact live set to a new verified DB and retire the old one. Retaining both forever keeps the storage bill.

Proposed retention: live fixtures/features needed by the active season and model; current quotes plus bounded recent snapshots; compact settlement/index records retained online; complete immutable historical records in Drive. Retention is dataset-specific and reversible through archive restore. Monthly recovery drill restores a sample across raw → canonical → projection → wager → official grade. Historical backtests explicitly restore selected partitions, not the entire corpus into live D1.

## 5. Enforcing the $10 ceiling

Cloudflare's paid Workers plan starts at $5; D1 paid allowances are shared across the account: 25 billion rows read, 50 million rows written and 5 GB stored, with overages. Separate sports do not each receive these allowances. Index maintenance also counts as writes. Budget alerts notify; they do not impose a hard spending stop.

Target steady-state D1 allocation, including indexes: CORE 0.15 GB; operations 0.05; NFL 0.25; CFB 0.70; CBB 0.65; NBA 0.35; WNBA 0.15; MLB 0.65; NHL 0.30; soccer 0.35; tennis 0.25; NPB 0.05; KBO 0.05. Total 4.05 GB, leaving 0.95 GB under the 5 GB allowance. These are proposed capacity envelopes, not present measurements. Adjust only within the aggregate cap. Archive growth before a database breaches its allocation.

Build one serialized account-wide admission controller. Every collector, mutation, administrative batch and direct endpoint must reserve a worst-case unit budget before work. Track reads, writes including indexes/triggers, CPU, requests, Durable Objects, R2 storage/operations and retained D1 byte-days. Reconcile query metadata with provider analytics; include other Cloudflare products and tax. Delayed/missing metrics or unknown cost fail closed. Reservations survive retries and concurrent invocations. Bound each SQL page, provider page, execution duration and retry count; prohibit expensive generic SQL and unchecked backfills.

Proposed operating policy: forecast normal total ≤$7 including estimated tax; warning at $7; global stop for dynamic work at projected $8 including accrued usage, reserved work and committed storage; retain $2 contingency. Lower thresholds if tax or other fixed commitments require it. Underlying operational unit limits must trip well before money thresholds: initial monthly soft targets ≤1 billion D1 reads and ≤5 million billed writes, validated against actual all-sport slate sizes. Reaching a limit means stale/paused features, not automatic paid overflow.

A low-cost cached/static board must survive the dynamic stop. No page load starts a collector, fit, export or historical query. The emergency stop must cover alternate hostnames, Worker routes, preview deployments, service bindings, manual GitHub dispatch and old credentials.

**A custom controller cannot provide an absolute financial guarantee on a metered paid account.** Billing lag, persistent storage and bypasses remain possible. The release gate must explicitly resolve this: either accept the conservative metered design with tested stop controls, or choose an architecture with provider-enforced limits/fixed cost. A genuinely strict ceiling requires the latter assurance. Moving to Workers Free is not a drop-in solution: current free D1 limits include 10 databases and 500 MB per database, so the eleven-sport-plus-shared topology needs redesign. Do not downgrade blindly or claim $10 is guaranteed.

## 6. Source and API contracts

This is the intended source register. Existing adapter presence is not proof that a key, subscription, storage permission or current endpoint is valid. Before activation, each provider gets a contract receipt: base URL/version, exact method/path/query, auth secret name, permitted use/retention, cost/quota, pagination, schema fixture, freshness, retry policy, fallback and owning job. No new paid subscriptions or automated paid actor runs are authorized by this plan.

| Source | Role and API wiring | Activation condition |
|---|---|---|
| Kalshi | REST `https://external-api.kalshi.com/trade-api/v2`: series/events/markets inventory, market details, orderbooks, resolution. Follow every cursor; maintain event/series manifests. | Read-only market collection; signed endpoints only where required; no trading scopes or order calls. WebSocket disabled initially. |
| Polymarket Global | Gamma event/market discovery and CLOB orderbooks/pricing; existing Gamma host `gamma-api.polymarket.com`. Token/condition mapping and complete pagination. | Global/reference classification retained; verify latest documented endpoints and restrictions; no US execution claim. |
| Polymarket US | Separate US API/SDK contract and independent credentials. Repo currently contains both `gateway.polymarket.us` and `api.polymarket.us` uses. | Resolve host/path/version discrepancies with current US documentation and fixtures before release. Never silently substitute Global data. |
| PinnOdds | Existing game/reference market ingestion and status adapters. | Confirm actual vendor URL, account quota and permitted storage; game lines only, not props. Disable if unapproved or unavailable. |
| CFBD | `api.collegefootballdata.com`; existing REST/GraphQL registry for schedules, games, play/team/player data. | Explicit subscribed tier, endpoint entitlement and commercial/retention rights. Fetch season history once; current deltas thereafter. |
| CBBD | `api.collegebasketballdata.com`; schedules, team/player games and scoreboard. | Same entitlement/rights checks. Backbone candidate, not automatically licensed for all uses. |
| KenPom / Torvik | Authorized KenPom API; low-frequency permitted Torvik bulk files. | No KenPom HTML scraping; PIT DataThrough retained; no new paid plan. Unapproved source stays research/unavailable. |
| NFL nflverse / official NFL | Versioned nflverse release assets; official roster/injury/inactive evidence. | Dataset-specific rights, release hash, season/week and actual availability timestamp. |
| MLB Stats API / Savant | `statsapi.mlb.com` schedules, starter/lineup/box evidence; `baseballsavant.mlb.com` authorized Statcast/expected-stat batches. | Actual adapter path contracts and usage terms verified; daily cache and immutable historical downloads. |
| Ballpark Pal | Existing authorized MLB overlay/comparison adapter. | Account/rights/cost verified; external overlay labeled; no substitution for independently validated core. |
| NHL | Existing `api-web.nhle.com/v1` and `api.nhle.com/stats/rest/en` adapters for schedule/results/roster/stats. | Fixture/schema tests, timestamps and terms reviewed; goalie status must have source/time. |
| NBA / WNBA | Existing official league/authorized statistical feeds; availability and roster sources; ESPN scoreboard fallback where existing. | Enumerate exact adapter URLs and tests; no invented official API guarantee. Reconcile player IDs and season types. |
| Soccer PitchAPI | Existing identity/store and discover/queue/ingest/export functions. ESPN league scoreboard fallback exists. | Record actual vendor host, leagues, credential, quota and retention rights; quarantine missing competitions instead of inventing coverage. |
| Tennis | Approved official tour/fixture/results feeds; source-backed serve/return data. TennisAbstract and Sackmann remain research where rights unresolved. | Written permission for restricted reuse; no market-derived Elo promoted as independent PURE evidence. |
| NPB | Existing official `npb.jp/games/.../schedule_..._detail.html` and official English stats parsers. | HTML adapter contracts and permitted low-frequency use; cache raw response, detect layout changes. |
| KBO | Existing official `eng.koreabaseball.com` schedule/standings plus Korean record/game-center parsers. | Same parser/rights checks; local date and starting-pitcher verification. |
| Weather / images | Authorized weather feed where relevant; source-authorized images with provenance. | Exact provider and terms registered. No automatic paid Apify/ACTION jobs. Existing approved images preserved. |

ESPN's existing public-facing scoreboard paths are fallback integrations, not a contractual SLA. No silent fallback may change market definition, feature semantics or settlement authority. Display missing data instead.

Remove PrizePicks acquisition; retain historical evidence. Disable PinnOdds prop acquisition and any old ACTION odds/props jobs. ACTION's historical exception was tennis imagery only; even that does not authorize new paid runs. Retain all accessible alternate thresholds from Kalshi/Polymarket before model matching. A processing budget may checkpoint an unfinished crawl, but the manifest remains INCOMPLETE and the UI must not imply complete coverage. Do not quietly cap at top-N or model-supported players.

Each canonical contract carries venue, jurisdiction, market/event IDs, athlete/team IDs, period, stat, threshold, direction, overtime/push/void rules, tick size, outcome/token IDs, price type, depth, fees and provider/received timestamps. Executable ask, bid, midpoint and last trade are separate fields. Display American odds with fee/liquidity caveats. Only compare model probabilities to compatible contracts.

## 7. All-sport completion matrix

All rows require identity mapping, authorized source receipts, PIT features, independent probabilities, settlement fixtures, board/API integration, archive restore and budget proof. Existing modules must be audited before adding replacements.

| Sport / D1 | Model and data completion | Market, grading and specific release proof |
|---|---|---|
| NFL / `fbis-nfl` | nflverse play-by-play and drive context, QB/personnel, official injuries/inactives, rest/weather. Preserve frozen model; audit newer feature modules and timing. | FG/spread/total and supported props; distinguish preseason; official final and stat corrections; scenario blocks when QB uncertain. |
| CFB / `fbis-cfb` | CFBD PPA/efficiency, roster/recruiting/returning context, opponent strength, weather and depth evidence. Keep research tiers separate. | Season/week/postseason identity, overtime semantics, FBS/FCS coverage and late corrections; frozen champion unchanged. |
| CBB / `fbis-cbb` | Finish consumer cutover from primary; preserve 28-table reconciliation. Authorized CBBD plus permitted rating inputs; OE/DE/tempo/four factors and home court with PIT cutoffs. | Finish migration ownership, freshness SLA, populated A/A fixtures, fault/rollback/recovery and independent CORE approval. User HCA PDF is a dated input requiring provenance, not current truth. |
| NBA / `fbis-nba` | Possessions/efficiency, minutes/role redistribution, availability, rest/travel; independent player distributions. | Team/player identities, trades and season types; confirmed status timing; minutes uncertainty; official prop grading and no duplicate game rows. |
| WNBA / `fbis-wnba` | Audit existing lineup, player-impact, role-redistribution and possession challengers; season-specific fits and prospective evidence. | Small-sample/availability gates; separate challenger results; offseason no-slate status; game and player result corrections. |
| MLB / `fbis-mlb` | Retain incumbent baseline; audit Statcast matchup/Pal ablations, starters, confirmed lineups, bullpen, park/weather. Remove replacement-write amplification. | FG vs F5 exact periods, listed-pitcher rules, postponed/doubleheader IDs, pitcher-K PIT evidence. SSW/xRA unfinished work remains explicitly blocked, never fabricated. |
| NHL / `fbis-nhl` | Exact production scoring kernel replay, goalie mixtures/status, strength-state distinctions and uncertainty. Audit existing approximations. | Regulation vs OT/shootout markets; prospective game/prop evidence. Remains shadow until its registered qualification gates pass; display confidence as evidence quality, not hit probability. |
| Soccer / `fbis-soccer` | PitchAPI league/season identity and completeness, authorized xG/event data, lineup/keeper/injury context, separate competition calibration. | 90-minute vs extra-time, 1X2/draw and handicap semantics; postponed/abandoned fixtures, timezone mapping and league-specific coverage. |
| Tennis / `fbis-tennis` | ATP and WTA separate cohorts; surface, serve/return, opponent quality, sample/fitness uncertainty, authorized premarket data. | Retirement/walkover rules, best-of-three/five, qualifying/doubles scope, tour/surface calibration. Every eligible fixture has independent snapshot or block reason. Portrait rights/coverage tracked separately. |
| NPB / `fbis-npb` | Japanese official schedule/stats, team/player aliases, starters, bullpen and park context; league-specific baseline. | JST dates, interleague/postseason, ties and extra-inning rules; no MLB coefficients assumed valid; market-only if no authorized matching market. |
| KBO / `fbis-kbo` | Official Korean/English schedule and advanced records, player IDs, starters, park/weather, KBO-specific baseline. | KST dates, ties/rain/called games, postponed/resumed rules and player-name collisions; constrained parser fixtures and independent validation. |

For every sport, evaluate time-ordered out-of-sample calibration, Brier/log loss, price sensitivity, CLV where valid closes exist, net returns, drawdown and sample sufficiency. Preserve separate market/cohort results. Actual qualification sample thresholds come from the registered sport gate; do not invent a universal threshold or promote from historical win-rate claims.

The supplied legacy ZIP contains earlier Python/R designs, old acquisition sources and claimed backtests. Preserve it in Drive, inventory reusable datasets, validate dates/rights/PIT and reproduce results before reuse. Its older Odds API/Heritage/KenPom instructions do not override the current market-source mandate. Never execute legacy scripts with embedded credentials or activate their scheduled jobs.

## 8. Complete pipeline and API wiring work

Create `ops/source-contracts` and a machine-readable job registry as implementation artifacts. Each job defines owner, sport, input/output schema, source entitlement, idempotency key, lease, dependencies, maximum API pages, SQL rows, timeout, retries, reservation and recovery checkpoint.

| Stage | Required behavior | Acceptance evidence |
|---|---|---|
| Discovery | Fetch authorized slate; reconcile source IDs; discover complete accessible market inventory | Event/contract manifests, page cursors, unknown aliases and explicit exclusions |
| Acquisition | Cache immutable raw response once; conditional requests/deltas where supported | Provider timestamps, checksums, request counters; no duplicate paid calls |
| Canonicalization | Resolve identities and contract semantics before joins | Collision tests, postponed/doubleheader/tour fixtures, correction history |
| Features | Build only from data available at the declared cutoff | Source manifest and max-available-at test; no future information |
| Projection | Execute versioned deterministic champion, separate challengers | Model hash, input hash, RNG seed if used, immutable output |
| Market attachment | Join compatible quotes after independent prediction | Quote classification, fees/depth, unmatched retained market-only |
| Board publication | Write compact immutable bundle; atomically swap current pointer | Cached reads, freshness timestamp, independent health without DB scans |
| Settlement | Official results first; venue resolution for contract-specific treatment | Final/push/void/correction test cases; append-only grade versions |
| Learning | Scheduled batch from archive, frozen evaluation cohorts | Reproducible report and proposed changes; no self-promotion |
| Archive | Upload and restore-verify completed partitions | Manifest, download hash and reconstruction report |

Inventory existing public/API routes before changing them. Each gets method, authentication, owning database, bounded SQL plan, request/response fixture, stale behavior and cost estimate. Read endpoints cannot trigger ingestion. Mutations require the job admission token, even when called manually. Sensitive account/portfolio endpoints stay private and read-only; trade endpoints remain disabled.

Suggested new internal contracts—not existing endpoint claims—are `job-admit`, `job-complete`, `cost-status`, `archive-manifest` and `release-health`. Prefer service bindings/private execution; expose no generic unauthenticated task runner. Version shared schemas and test consumers against recorded provider fixtures before network calls.

## 9. Production schedules versus assistant tasks

### One deterministic production schedule

Use one dispatcher and one job lease per sport/source/time window. Start without continuous WebSockets or in-play projections. Event-time scheduling is more efficient than polling every sport every ten minutes.

* Daily: slate/identity reconciliation; current authorized stats deltas; previous-day official results/corrections; archive finalized partitions; one compact cost/freshness receipt.
* Pregame: proposed initial checkpoints at approximately T−24h, T−60m and T−5m for active events, with sport-specific availability/lineup cutoffs. Source delays yield explicit stale/blocked status. Coalesce overlapping requests. Re-evaluate these times against measured cost and useful decision latency.
* Market inventory: complete initial active-event discovery plus bounded scheduled deltas and pregame refresh; carry pagination checkpoints until complete. Do not refetch full history each time.
* Settlement: bounded post-event windows and daily correction reconciliation; no blind hourly scanning of every settled event.
* Weekly: archived research/calibration batch, source entitlement review and capacity forecast, only within approved compute quotas.

Heavy fitting/backfills run locally by default. GitHub free/included minutes and third-party quotas must be checked rather than assumed unlimited. GitHub CI tests recorded fixtures; no paid network calls on pull requests. Build one approved workflow per clear purpose from the preserved files; do not restore 318 workflows.

### ChatGPT Scheduled Tasks: proposed reduced role

Keep the current CI Auto-Repair and Gemini Heartbeats tasks disabled. Replace their broad permissions with the following only after trustworthy receipts exist. Times proposed in America/Chicago; DST handled by named timezone.

| Task | Cadence | Reads | Output / permitted action |
|---|---|---|---|
| FBIS daily operator review | Daily 08:15 CT | Latest signed cost, job, source, board and archive receipts; incident/handoff rows | One concise exception report; append a deduplicated handoff if explicitly authorized. No repair, deploy, source collection, SQL scans or paid APIs. |
| FBIS weekly build and model review | Monday 08:15 CT, replacing that day's daily review | Release matrix, test receipts, qualification summaries, storage trend | Prioritized engineering backlog; separate model research proposals. No coefficients/threshold changes or automatic task dispatch. |

Reusable task instruction: “Review only the latest FBIS summary receipts and bounded registry/incident rows. Confirm timestamps, producer SHA and sport coverage. Compare against the $10 inclusive-tax ceiling and registered release/model gates. Report missing/stale evidence and deduplicate incidents by stable ID. Never start provider calls, exports, database-wide queries, repairs, deployments, paid services, wagers or model promotion. If tools or receipts are unavailable, state UNKNOWN rather than infer success. Keep green reports short; escalate only actionable new changes. Do not email others.”

### Gemini Scheduled Tasks: independent verification

Do not resume the nine old tasks unchanged. Merge overlapping incident/health/handoff/failure checks and remove the obsolete “seven sport databases” scope.

| Task | Cadence | Independent responsibility |
|---|---|---|
| FBIS daily evidence verifier | Daily 08:45 CT | Cross-check published board bundle against canonical receipt, all eleven sports, venue semantics, completeness and source provenance. Use small recorded samples, not recollection or full DB scans. |
| FBIS weekly storage and release verifier | Thursday 08:45 CT | Inspect archive verification/restore receipts, aggregate storage forecast, source rights, job ownership and release SHA; identify disagreements with implementer. |

Reusable Gemini instruction: “Act as FBIS's independent read-only verifier. Check current signed receipts, manifests, release registry and explicitly bounded samples for all eleven sports, with ATP/WTA separated. Verify Kalshi/Polymarket accessible-inventory pagination before model joins; unmatched props remain market-only. Keep Polymarket US and Global separate, and PinnOdds game-only. Confirm premarket independence, freshness, restore evidence and account-wide budget controls. No ACTION/Apify paid runs, PrizePicks acquisition, repairs, migrations, deployments, provider collection, model promotion, bets or paid model API calls. Report PASS/FAIL/UNKNOWN with exact evidence and a stable incident ID; do not claim success from absence of evidence.”

These assistant schedules are reviews, not guaranteed uptime monitoring. Use deterministic cost/health tripwires for immediate protection. App subscriptions and task/tool entitlements are separate from API billing; verify access before enabling. No automated OpenAI/Gemini API dependency is required. Explicitly disable the orchestrator's currently default-enabled LLM-selection path and remove fallback calls to OpenAI Responses and Google `generateContent`. Replace selection/commentary with deterministic eligibility and reason templates.

During the build, use manual milestone reviews instead of recurring tasks. Maintain the existing Agent Schedule Registry and Sport Scope Registry as the single human-readable schedule inventory. Mark legacy entries retired/paused with dates rather than deleting their history. Add archive/source/budget registers and missing sport operational coverage to the tracker. Sheet writes must be authorized, bounded and owned by one job.

## 10. Work packages and release order

| Order | Work package / owner role | Exit gate |
|---|---|---|
| 0 | Implementer: reverify shutdown, billing/refund and source-of-truth inventory | Every runnable entry point classified; no unowned scheduler; actual latest costs and stored footprint recorded |
| 1 | Implementer + independent verifier: cost architecture | Global reservation prototype, bypass/concurrency/failure tests and explicit hard-ceiling architecture decision |
| 2 | Data engineer: Drive foundation and recovery pilot | Private folders/catalog, quota/auth checks, one full database-group export/download/restore pass |
| 3 | Data engineer: bulk history retirement | All large history/primary duplicates archived and verified; reviewed deletion/cutover; actual total billed storage within envelope |
| 4 | Platform engineer: database and scheduler ownership | All eleven consumers mapped; primary fallback removed after each approved cutover; one job owner; no production bulk copier |
| 5 | Sport implementer: source/model/market/grade contracts | Each sport passes its row in the completion matrix; rights/quota blockers visible; no fabricated fallback |
| 6 | Frontend/platform engineer: full board and tracker wiring | All views work from cached bundles; odds, freshness, market-only/research/qualified states and corrections tested |
| 7 | Independent verifier: integrated rehearsal | Restore, rollback, expensive-query, retry, duplicate-dispatch, metric-delay and budget-stop tests pass with receipts |
| 8 | Release operator: staged production | One active sport canary, then additional sports in measured waves; release evidence and immediate rollback path |
| 9 | Operator: minimal assistant reviews | New read-only prompts verified, old tasks remain retired; no duplicate reviewers doing collection |

Parallel source/schema/model preparation is possible while archival proceeds, but production reopening depends on packages 0–7. Build readiness is measured in completed gates; a calendar date cannot manufacture model qualification or vendor permissions.

Suggested rollout: first a cached read-only board; then one active sport with the cleanest source rights, proven DB route and low measured cost. NFL/NBA/NHL/CFB have prior sport-mode configurations, but none gets automatic reapproval. CBB should use its recent reconciliation evidence once its remaining cutover gates close. Select further waves by readiness and active slate, including MLB/tennis/soccer, then remaining sports. NPB/KBO/WNBA may show offseason or no qualifying market without being hidden. All eleven must pass technical gates before declaring project complete.

For each activation: publish one immutable release manifest → run one bounded manual acquisition → reconcile source-to-card-to-grade fixtures → observe a complete real event/settlement cycle when available → reconcile cost units and forecast → admit the next sport. Require several normal operating days and representative peak-slate replay before declaring steady state. Inactive sports use recorded fixtures plus a future live-season check; label this limitation.

## 11. Mandatory acceptance and rollback checks

* SQL: indexed query plans on every hot filter/sort; no archive backlog COUNT loops; unchanged reruns produce zero unnecessary writes; actual billed write metadata includes index/trigger effects.
* Duplication: simultaneous dispatcher/manual/agent retries produce one lease and one canonical write; reservation cannot be bypassed by direct endpoints or alternate hostnames.
* Completeness: every eligible event accounted for; full accessible prop pages, threshold variants and unmatched records retained; unfinished crawl cannot report COMPLETE.
* PIT: future-dated feature injection is rejected; independent model probability is frozen before market attachment; source revisions preserve original availability.
* Failure: 429, auth expiry, changed HTML/JSON schema, provider outage, partial upload, lost checkpoint and correction replay all fail safely with actionable receipts.
* Recovery: independently restore archived schema/data and reconstruct projection → contract → wager → official result. Do not delete source until this works.
* Economics: all-sport busiest-day replay includes CPU, storage, reads, index writes, R2/DO usage and tax; unknown billing inputs block release.
* UX: source/freshness/blockers visible; stale executable price cannot appear live; no API secret in browser; private account data protected.
* Stop: a deliberately tripped budget/lease/health failure stops all dynamic paths while retaining the static board. Persistent storage costs remain in the forecast.
* Rollback: restore prior verified compact bundle and code; disable admission and cron; retain evidence. Database rollback uses tested manifests/backups, not a promise to reconstruct later.

The release receipt must list SHA, DB bindings/modes, schema versions, enabled jobs, provider rights/quota receipts, storage footprint, actual measured cost units, tests, open model blocks and rollback target. An independent reviewer signs off engineering evidence. Any unresolved material cost or integrity issue returns the sport/platform to paused mode.

## 12. Definition of done and immediate next actions

The project is complete when all eleven sports have verified source contracts, canonical ownership, PIT projections or explicit evidence-based blocks, full market inventory accounting, official settlement, Drive recovery, functioning UI/API paths and registered operations; the account meets the selected cost architecture; and a staged live rehearsal has passed. Wagering authority remains per model/cohort.

The first implementation sequence is: recheck stop and accrued charges; build the budget/admission proof; establish Drive folders/catalog and restore pilot; export the large history databases; verify recovery; retire verified redundant D1 storage; finish sport routing and source contracts; complete board/settlement wiring; rehearse and release one sport at a time. Do not finish the build by turning all old jobs back on.

No new scheduled tasks, Drive migrations, database deletions, paid services or production releases were performed by preparing this plan.

## Evidence and reference register

Primary project sources reviewed include the [platform alignment mandate](https://docs.google.com/document/d/1RM7HqVyjNWhu9xWsVjtL9fKayww6HF_w_DvVH10pRoA), the [FBIS tracker](https://docs.google.com/spreadsheets/d/1B1IVONVvmP50JPCqb64fzEsSaTv6AuHQ04YqEzBhjAo), and these repository paths at the checked baseline: `functions/lib/databaseTopology.js`; `functions/lib/canonical/sourceRegistry.js`; `functions/lib/collegeApi.js`; `functions/lib/cfbCfbdSourceRegistry.js`; `functions/lib/nflVerseFeed.js`; `functions/lib/nhlDataSources.js`; `functions/lib/npbFbisV1.js`; `functions/lib/kboAdvanced.js`; `functions/lib/polymarketUs.js`; `functions/lib/polymarketUsAccount.js`; `services/sports-projection-orchestrator/orchestrator.mjs`; `docs/cbb-cutover/2026-10-25-completion-progress.md`; `docs/nhl-production-qualification-20261020.md`; `docs/mlb/completion-and-world-series.md`; `docs/tennis-phase3-portrait-and-projection-rebuild-20261022.md`; `docs/tennis-research-source-authority-audit.md`; and `ops/cost-stop/README.md`. Older design documents may be stale and require implementation checks.

The Agent Schedule Registry contains historical active cron descriptions and broad repair permissions; its contents are not current scheduler-state evidence. It must be reconciled with the actual paused systems before enabling anything.

Provider references checked for planning on 27 October 2026:

* [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing FAQ](https://developers.cloudflare.com/d1/reference/faq/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
* [Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Drive downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads), [Drive API limits](https://developers.google.com/workspace/drive/api/guides/limits).
* [Kalshi market API](https://docs.kalshi.com/api-reference/market/get-markets), [Polymarket Global API](https://docs.polymarket.com/api-reference/predictions/overview), [Polymarket US documentation](https://docs.polymarket.us/getting-started/welcome).

API versions, entitlements and terms must be rechecked at implementation. Provider documentation establishes capabilities; it does not establish FBIS's current account permissions.
