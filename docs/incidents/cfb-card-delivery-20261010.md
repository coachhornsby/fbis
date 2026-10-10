# CFB projection-card delivery repair

## Verified checkpoint and scope

Main and Pages production: `d5d8499050c7ac0ce607d709baa234c4809678ec`.
Pages deployment: `e8132f07-8296-43ad-8200-73daab317665`, successful production deployment.
Canonical migration: `0097_apify_acquisition_authority`.
Read-only D1 inspection found 313 October 10 snapshots for 139 games, 214 odds rows for 44 games, and 139 stored games. No production mutations were performed.

The API was not invoked live: deployed CFB card reads can acquire paid-provider data on cache miss and write odds-health metadata. The failures below were reproduced locally through the actual deployed handlers with fixed clocks, fixture source responses and write-rejecting D1. They are not claimed as observed live HTTP responses.

## Root cause

`promoteCfbFbisV2ToBoard` placed approved fitted scores at the top level while retaining an older or unavailable `game.model` packet. Product API, Board serializer and snapshot writer prefer that nested packet. In a deterministic reproduction for event 401860902, fitted 23.8 / 25.4 became the old 17.4 / 28.9 at serialization. An unavailable prior hid the fitted prediction entirely.

Models also counted `Number(null)` as a genuine zero-valued prediction. The primary Board card converted missing market differences to a zero edge. Cache-only odds reads could launch fallback providers; CFBD feature cache misses also acquired data. CFB failed schedule discovery could become an empty success, and its weekly API response differed from the Board's Central-time date scope.

## Repair

Synchronize the already-computed fitted scores into the consumer packet; reject malformed fitted values. Preserve original feature clocks, prior layers, coefficients, scoring calculations and existing qualification blocks. Expose version/state in the product contract and provisional/no-authority labels on the actual Board card.

CFB product reads use existing caches only for CFBD and paid odds providers; collection callers retain their existing behavior. Suppress read-path odds-health writes, retain upstream schedule errors, and apply the existing Board date rule. Missing Models scores remain unavailable; genuine zero remains valid. No historical snapshot fallback was introduced.

## Same-game evidence

The three production identities below have FIRST_AVAILABLE / EARLY snapshots frozen at 2026-10-08T19:09:03.979Z. Those old rows lack the consumed fitted-feature packet; they are not safe evidence for recreating fitted historical predictions. They were not attached as current projections or rewritten.

| Event | Home / away | Persisted old scores | Local current fixture fitted scores | Margin / total | State / authority |
| --- | --- | --- | --- | --- | --- |
| 401860902 | Oregon State / San Diego State | 17.4 / 28.9 | 19.1 / 29.9 | -10.8 / 49.0 | PROVISIONAL / blocked |
| 401862798 | Memphis / UAB | 35.5 / 15.5 | 36.9 / 15.1 | 21.8 / 52.0 | PROVISIONAL / blocked |
| 401856715 | Kentucky / LSU | 17.7 / 27.1 | 20.1 / 29.2 | -9.1 / 49.3 | PROVISIONAL / blocked |

The current fixture uses real event identities and kickoff times but controlled source responses. These numbers demonstrate delivery parity, not production improvement or historical prediction recovery. The regression runs real slate construction, API serialization, Today Board serialization, frontend view-model checks and snapshot generation. Every stage retains the fitted scores; missing prices remain null. Write attempts and paid-provider requests are zero.

## Validation and limitations

Focused card/weather tests: 32 passed, zero failed. Full standard suite: 1,361 passed, zero failed, using a network-blocking preload. Weather/Kalshi tests now use explicit offline fixtures instead of live providers without weakening existing assertions. Actual PremiumGameCard server rendering contains the fitted score pair, PROVISIONAL and NO BETTING AUTHORITY. This is not live mobile-browser acceptance.

Build, function syntax, migration verification and diff checks are required before delivery. Existing build warnings include duplicate role/case clauses, CSS escape syntax and chunk size; this repair does not address them.

## Release and acceptance plan

1. Independent review of the exact PR HEAD; operator merge/deployment authorization remains required.
2. Confirm production SHA after the normal release; do not apply migrations or replay jobs for this repair.
3. On the deployed CFB API, verify canonical IDs, CT date, fitted/nested score parity, margin/total, version, provisional state and `canQualify:false` without provider requests or D1 writes.
4. Open Board and Models on mobile. Check the same three valid current events, visible scores, explicit missing-market presentation and blocked authority. Inspect console/network content, not merely HTTP status.
5. Observe a naturally created checkpoint retaining the same fitted packet; do not republish historical snapshots.
6. Roll back by reverting this code-only commit through the authorized release path. No production data rollback is needed because no historical records or schema were changed.

Release verdict: PATCH VALIDATED — PRODUCTION VERIFICATION PENDING. Missing current features can still produce provisional projections; this patch does not mark them READY or qualify wagering.
