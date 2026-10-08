# ACTION final pre-merge hardening — review only

Baseline PR #914: `0ac94fcb47265215e5b01001e6e206b247e94ae8`. Baseline PR #915: `2ca9ffeaafcdf438867a5f38a079347f2582ce94`. Both matched their verified checkpoints; no concurrent remote advancement or tracked local edits were found. Main/Pages remain `6a2e90b47be57b7f3d565a14d40056a0646909d2`. This adds a fast-forward commit to #915, leaving #914 and the stacked base untouched. No reset/rebase/force-push/new PR/merge/deploy.

## Confirmed findings

### A — Selection before eligibility: VERIFIED DEFECT

`loadLiveActionMisprices` reserved the first observation slot per event before validation. A returned invalid observation (malformed/future source, absent/future capture, source after capture or expired research) suppressed independently valid evidence. Check the same shared six-hour research validity before reserving the slot, retaining build-time validation as defense in depth. Preserve existing query/returned order among eligible rows, including equal timestamps; no new source-priority or identity policy. Keep missing optional source time unknown, acquisition mandatory, 600-second CURRENT_RESEARCH classification and six-hour maximum historical window.

The bounded reader still has its existing 200/default, 500/max cap and text-ordered query. This repair does not claim valid rows outside that fetched set are examined, or introduce a chronological/tie-breaking selection policy. Mixed-format ordering and capped starvation require measured evidence and a separate bounded decision before expanding queries.

### B — Contradictory source/provider precedence: VERIFIED DEFECT

`source || provider` hid ACTION acquisition when source held a named book. The required HERITAGE/ACTION_APIFY quote with missing capture passed. Reverse ordering already rejected. Check ACTION provenance in either field. Named sportsbook and acquisition provider are distinct: `tennis_market_snapshots` has separate provider/sportsbook; `persistTennisVenueOffer` stores sportsbook as source and provider in raw provenance. A named book does not certify independent acquisition.

Keep original source and provider through quote normalization. At packet persistence, preserve the supplied ACTION acquisition label from either field and original capture time, rather than replacing provider with the book label/restamping acquisition. Different non-ACTION labels and unspecified metadata retain existing benchmark behavior and the prior source/MARKET_FEED persistence fallback; this does not grant independent-book or wager authority. Provenance beyond the supplied fields remains unverified; no guessed dataset/run/event mapping.

### C — 24-hour/future-skew helper: VERIFIED DEFECT

Private `currentActionIntel` had one caller: `toDomainEvent`. It admitted stale observations up to 24 hours, five-minute future skew, fallback observation/archive-like timestamps for missing capture, permissive Date.parse, and invalid clock fallback. Replace it with existing `currentActionDisplay`/shared predicate before public splits and movement derivation. This also excludes stale standalone ACTION sentiment when actionIntel is absent. Preserve independent operational lines, projections, decisions and owned sentiment.

## Legacy helper consumer trace

| Path | Classification | Fields/use and disposition |
|---|---|---|
| `toDomainEvent` → movement/public splits/actionIntel | CURRENT / DISPLAY ONLY | Original capture/source validity before opening/current movement, magnitude, count, time, public split fields |
| `toDomainTodayBoard` → selectMarketMovers → MarketMovers | CURRENT | Measured movement magnitude sorts movers; invalid ACTION no longer contributes |
| `toDomainTodayBoard` → selectWatchlist → WatchlistPanel | CURRENT / DISPLAY ONLY | Watchlist membership maps decision state, not ACTION; line/movement text guarded |
| `toDomainTodayBoard` → TopGameOpportunities | CURRENT / DISPLAY ONLY | Qualified/watchlist ordering unchanged; ACTION movement/split badges/text guarded |
| `functions/api/today.js` additive domain serialization | CURRENT | API passes request attemptAt as decision clock; model/qualification state unchanged |
| TodayCommandCenter client reconstruction | CURRENT / DISPLAY ONLY | Passes board.domain.generatedAt; same input predicate; no historical research contract found |
| buildGameWorkspaceView → GameWorkspace | CURRENT / DISPLAY ONLY | Movement/quality panel; no model or wager decision calculation from helper |
| buildPlayerPropsBoard domain mapping | CURRENT | Player props ranking uses prop/model evidence, not helper movement; existing authority preserved |
| `toMovementSummary` direct exported calls | UNKNOWN for future callers | Current repo production call only receives sanitized domainGame; direct external callers unverified |
| Historical ingestion/grade/publication | NOT FOUND as helper callers | No change to historical capture or frozen published payloads |

Explicit opts.generatedAt/opts.collectedAt clock semantics remain unchanged, except malformed clocks fail closed instead of silently using now. Cached UI rerender age relative to an old generation clock and untagged flat movement/public fields have incomplete provenance/clock semantics; do not infer ACTION origin or invent a new historical/current policy. A separate consumer-clock/flat-field investigation needs exact producer evidence. This is not platform-wide integrity clearance.

## Deterministic validation

`test/action-final-closure.test.js`: first 29 cases produced 17 failures/12 passes at original HEAD, then passed after correction. Additional fixed-clock invalid-clock/UTC normalization coverage brings the final focused total to 30. The committed-baseline before/after script independently executes the actual source functions with fixture clock `2026-10-08T12:00:00Z`, retaining original timestamps and raw fixtures in evidence. It is local reproduction, not production acquisition/publication proof.

Cases include all requested selection/provenance/calendar-preservation boundaries, equal timestamp order, independent events, both ACTION label directions, missing optional provider time, stale/future acquisition, observation-after-capture, retained quote acquisition provider and no-vig math, mover exclusion, owned line preservation and watchlist/authority invariants. Existing Phase 2A/2B NFL/NBA/WNBA/Tennis/immutable-publication tests run in compatibility and standard suites.

Full local gates and available hosted checks must pass at exact final tree. Standard CI only triggers main-target PRs; #915 remains stacked on #914, so its new-head standard hosted CI is not available from the existing PR trigger. Do not retarget/rebase, alter workflow policy, or report the earlier 1,348-test hosted result as validation of the new tree. Available Tennis PR validation can run naturally; local full-suite evidence and hosted job results are recorded separately. After separately approved Phase 2A integration, an operator can authorize main retarget and exact-head standard CI before #915 merge.

## Governance and next decisions

No model coefficients/thresholds/champions, probability/EV math, qualification/wager authority, schema, paid source policy, reservation, historical capture/publication, D1/R2 or production artifact changes. ACTION/PrizePicks stay BLOCKED. October 7 reservation stays RESERVED. No paid Actor, replay or production validation POST. Production Integrity Gate remains design-only; a future gate should test invalid-row suppression, multi-field provenance preservation and consumer decision-clock lineage as semantic outcomes.

GO independent bounded code review. STOP merge/deploy absent separate authorization and exact-head release checks. Production SHA/policy/reservation inspections are actual read-only evidence; D1 publication reconciliation, R2 bodies, provider billing and external saved/manual consumers remain outside this run. UNKNOWN is not HEALTHY.
