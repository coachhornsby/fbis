# ACTION temporal integrity — Phase 2B closure

Review-only stacked PR on Phase 2A. Merge/deploy is not authorized. Production baseline remains `6a2e90b47be57b7f3d565a14d40056a0646909d2`. ACTION/PrizePicks remain BLOCKED. No schema, model math, coefficients, qualification, wager-authority, policy, reservation, acquisition or historical publication changes.

## Verified defects and bounded correction

1. `actionMarketIntelligence.js::buildActionMispriceRows` defaults a missing timestamp to fresh and admits future dates because it only checks `now - ts <= six hours`. Furthermore `evaluateMisprice` uses `marketFresh` only for calibrated pricing; ordinary projection deltas still survive and rank even for stale data. Validate at the input boundary before calculating/ranking. Require original collected_at; validate supplied source_observed_at/observed_at separately. Do not substitute scraped_at, created_at or request time. Keep the existing six-hour research lookback. Rows at 0–600 seconds are CURRENT_RESEARCH; valid rows at >600 through six hours are HISTORICAL_RESEARCH with currentMarketComparisonAvailable=false. Older rows and invalid timestamps do not enter this endpoint's research rankings. Model/delta formulas and authority flags remain unchanged.
2. `/api/misprices` stored fallback serializes `canonical_misprice_snapshots` without temporal validation and can display stored AUTHORIZED/calibrated values despite independent source flags. Production schema contains only market_timestamp and created_at, no source identifier or acquisition timestamp. Do not guess identity/provenance. Those records remain intact and accessible in a separate historicalSnapshots envelope with currentUse=false and UNVERIFIED_SOURCE_AND_ACQUISITION. They cannot enter current rankings. Read-only production query returned zero stored rows on October 8 at 12:29:35Z, so stored fallback reproduction is synthetic/code-backed, not a claim of actual current production contamination.
3. Today clipboard serialization copies the whole game including previously derived NFL ACTION comparisons. Sanitize at export, rebuild fresh NFL comparison from its valid raw ACTION + independent projection, otherwise null it. Always label exported packet HISTORICAL_RESEARCH/currentUse=false. Save/request timestamp cannot certify source freshness. Raw retained packets stay unchanged. The helper also supports revalidation after JSON reload; no generic application packet importer exists in the traced repository, so external ChatGPT/text consumers remain outside enforceable FBIS code.
4. Tennis saved decision/market read endpoint returns derived historical values with no use label. Add explicit HISTORICAL_RESEARCH/currentUse=false per row. Packet POST already recomputes from validated raw ACTION quotes/intel rather than accepting old derived values. Quote normalization dropped collectedAt and the packet persistence loop restamped ACTION capture with now. Preserve collectedAt through normalization and persistence; leave non-ACTION collection behavior unchanged.
5. Published projection retrieval returns immutable saved payloads without explicit temporal-use metadata. Add HISTORICAL_PUBLICATION/currentUse=false on the outer envelope; leave stored payload and payloadHash untouched. No model recalculation, database rewrite or historical proof upgrade occurs.

## Source and consumer graph

| Producer / storage | Consumer | Classification / repair |
|---|---|---|
| ACTION raw acquisition → shadow_market_observations | live ACTION↔predictions/prediction_snapshots join → misprices | Confirmed missing/future/stale input defect; pre-calculation validity and separate current/research semantics |
| canonical_misprice_snapshots | misprices stored fallback → src/features/misprices/MispricesView.jsx | Confirmed provenance-free current serialization; historical quarantine, no current ranking |
| Misprices JSON | MispricesView only in repository search | Display research, no observed qualification/wager-authority consumer; historic labeling visible |
| Slate/Today game → clipboard JSON | Manual ChatGPT research export | Confirmed serialization retains derived values; sanitized historical view at copy time; external handling not enforceable |
| NFL decisions → nfl_wager_decisions.wager_intelligence_json | No repository production read path found | Immutable research/evaluation evidence; future loader must validate, not infer from evaluated_at |
| Submitted Tennis packets → sharp prior/residual → tennis_v2_research_decisions | Tennis GET / saved market selection | POST recomputes and revalidates ACTION (Phase 2A); GET explicitly historical (Phase 2B); persistence provenance retained |
| published_projections.payload_json | published-projections GET, publication/proof/report scripts | Immutable historical publication; outer label added, payload/hash untouched |
| Browser projection ledger | src/TrackView historical tracking | Stores selected independent projection/owned market fields, not ACTION consensus/NFL intelligence; unchanged |
| Existing source/model APIs and other sports | Shared guards from Phase 2A | Unchanged by Phase 2B; no blanket platform-wide coverage claim |

## Unresolved evidence and decisions

- Stored canonical misprice provenance is absent from schema; current promotion is STOP until an independently proven source/acquisition mapping exists. Do not invent an ACTION/owned-source classification.
- No generic saved/manual packet importer or read-current consumer exists in the traced production repository. The tests exercise serialized/reloaded copies of actual packet shapes and existing entry boundaries, not an invented production importer. External manual copies cannot be made self-expiring by FBIS. If a separate service imports them, provide exact endpoint/repository and source contract for independent review.
- A future historical research UI may expose more than the current six-hour endpoint contract. This patch does not add arbitrary historical-window policies or endpoint replay.
- Provider observation time is optional under existing Phase 2A capture semantics when genuinely absent. Acquisition time remains mandatory; a supplied malformed/future observation fails closed. Changing mandatory provider-time policy needs separate provenance review.
- PostgreSQL-style/S3/R2 timestamps, date-only inputs, timezone-free ISO inputs, and nonzero precision beyond milliseconds remain unavailable. No timestamps get restamped to rescue validity.
- No natural fresh paid-source positive production proof is available while sources are blocked. Local fixtures and hosted CI are not production acquisition proof.

## Validation and acceptance

Deterministic tests cover exact current and research boundaries, missing/malformed/future/source-after-capture times, timezone equivalence, absent line values, stored fallback, JSON reload, mixed old-derived/fresh-raw packet repair, owned sportsbook preservation, historical read labels and immutable publication payload/hash. Phase 2A adds Gregorian year/offset/precision/overflow cases. Standard suite, compatibility suite, build, function syntax, migrations and diff checks must pass on exact published trees. See attached run evidence for final counts and hosted IDs.

## Deployment sequence and rollback

1. Independent review of Phase 2A final diff/CI. No automatic merge. Obtain separate approval for exact SHA and recorded production baseline.
2. Deploy Phase 2A only through the repaired release path after approval. Check content-level NFL/NBA/Tennis invalid-source behavior, independent markets/models, actual production SHA, policy/reservation invariants and mobile rendering. Do not run paid acquisition or historical ingestion to create examples.
3. Review Phase 2B's incremental stacked diff independently. After Phase 2A merge, retarget/rebase onto main, re-run full hosted checks and obtain separate Phase 2B deployment approval. No reuse of CI at a different resulting tree.
4. Post-approved Phase 2B deploy: `/api/misprices` valid research labels / no unverified stored current rows; `/api/tennis-v2-snapshot` historical labels; `/api/published-projections` immutable payload/hash + historical envelope; mobile Misprices historical labeling; copy/export stale ACTION unavailable. Confirm actual body/lineage, not HTTP 200. Avoid production POST/paid workflows for acceptance. Some board GET routes persist decision snapshots: their execution needs deployment-acceptance authorization.
5. Rollback Phase 2B to the approved Phase 2A Pages artifact; rollback Phase 2A to prior recorded immutable baseline artifact if separately authorized. No D1/R2 rollback/mutation. Retain policies BLOCKED, record restored known defects, confirm SHA/mobile/API semantics. Do not replay, clear reservations or change authority.

Production Integrity Gate design is separate in `docs/production-integrity-gate-design.md`. Implementing it needs its own bounded PR and authorization; it is not part of this runtime patch.
