# Phase 4 — native odds evidence feasibility

## Decision

**SharpAPI: NO-GO — UNVERIFIABLE EVIDENCE under the existing quote contract.** No genuine complete native response or independently timed receipt was located in inspected storage. Its currently documented `timestamp` is a feed-refresh clock which can advance without source re-observation. It cannot be relabeled as original quote observation. **The Odds API: CONDITIONAL — MISSING SPECIFIC EVIDENCE.** Its documented market clock is more suitable for a provider-observation benchmark, but no complete existing native response/receipt, executable-state interpretation or account preservation rights were verified. Neither receives an evidence-qualified or commercial GO. No alternate-provider search was expanded.

No speculative provider adapter or capture infrastructure was built. Phase 2 and Phase 3 remain the authority for eligibility. This phase adds only contract regression tests, the evidence record and decision documents. A genuine payload is a prerequisite for implementing and independently reviewing an offline field mapping; documentation examples are not acquired offers.

## Verified checkpoint

At 2026-10-10 05:07 UTC (October 10 00:07 CT), main and production remained d5d8499050c7ac0ce607d709baa234c4809678ec, Pages deployment e8132f07-8296-43ad-8200-73daab317665 success. PR930 d754f09c5dc56de4c6698b5dc578404fab5f971f, PR931 1e5ac9010be2e02778449d2403ab381a954addea and PR932 dede723a63b2bf4481ce9e0ceacaba65addf7cef remained draft/unmerged. Phase3 CI38022747063 succeeded. D1 tip0097; ACTION/PrizePicks BLOCKED/ACCOUNT_RESTRICTED, Apify BLOCKED/APIFY_USAGE_LIMIT_REACHED. No policies, reservations, model authority or production records changed.

Exact read-only SQL and connector results: docs/evidence/situational-phase4/p4inventory.json and p4storage.json. Reads record rows_written=0, changed_db=false. Object listing used per_page1000; raw/ returned232 objects and no matching SharpAPI/The Odds API/Parlay keys. Specific raw/sharpapi/, raw/theodds/, raw/odds/ prefixes were empty. This is inspected namespace coverage, not proof no response exists elsewhere. No source provider endpoint was called. Public documentation GETs incurred no acquisition requests.

## Real evidence counts

| Population | Complete native responses inspected | Quotes qualified | Evidence limits |
|---|---:|---:|---|
| SharpAPI | 0 | 0 | No native bytes, receipt, original-observation authority or account terms |
| The Odds API | 0 | 0 | No native bytes, receipt, actual market last_update, suspension contract or terms |
| D1 odds_snapshots | not native; 54,873 derived rows counted, 8 rows inspected | 0 established | Capture clock only; no original raw reference/hash/source observation/state columns |
| GitHub run38021733617 artifact | native contents not downloaded | 0 | One NFL live-ops artifact; producing script preserves downstream API/publication evidence, not original provider responses |

D1 counts: CFB moneyline41610, spread4654, totals4665 (50929 total); NFL moneyline3678, spread136, totals130 (3944 total). All book labels are Pinnacle. First/last captures and eight latest rows are in the evidence file. A named-book label does not establish the native source, actual offer executability or preservation provenance. Schema insufficiency blocks all these rows as evidence under the current contract; they were not fabricated into canonical adapter records. Native accepted/rejected quote counts are both zero because no genuine native population could be tested.

The previously attached ZIP was already inspected for odds-related contents: basketball-oriented exports and empty NCAA odds responses are not NFL/CFB contemporaneous quote evidence. Five ACTION R2 bodies remain unverified from Phase3; reopening blocked sources or retrying unrelated archives cannot repair the missing native SharpAPI receipt. No historical clocks were inferred, substituted or reconstructed.

## Actual source-to-storage boundaries

SharpAPI: functions/lib/sharpApi.js fetchOddsPage reads native response text/JSON, returns data rows and partial rate metadata. It does not preserve bytes, response hash, independent receipt or all headers. rateMeta.asOf is request-time generated. fetchSharpApiOdds requests one page per market with limit200, does not retain pagination completeness and converts rows through sharpRowsToEvents. This mapping retains display identity/price/line but drops original timestamp, is_active and raw response lineage. Thus current displayed game counts are not a full candidate universe or usable evidence count. Do not add pagination requests to satisfy this phase.

The Odds API: functions/lib/parlay.js fetchTheOddsJson reads JSON and parseEvents passes event objects. This may retain market last_update inside the immediate event array; subsequent outcomes() flattening drops market clocks, and the writer stores selected derived values. Original JSON bytes/headers and an independent receipt are not retained by that path. Do not claim every intermediate object lacks all timestamps. functions/lib/cache.js caches the transformed payload in memory/Cloudflare Cache API, not a durable original-response archive. Do not invoke a collection endpoint to inspect that cache: a cache-only request can fall through to native provider fetches.

functions/lib/store.js persistOddsSnapshot writes book/market/side/line/price plus captured_at and optional period/event/start/checkpoint. It has no original provider clock, raw hash/reference or suspension state. captured_at cannot be copied into observedAt. Existing pipeline production behavior is untouched.

## Source semantics and economic implications

SharpAPI official docs (retrieved October10):
- https://docs.sharpapi.io/en/concepts/pinnacle-odds-changed-at/ — timestamp reflects refreshed delivery, not necessarily a new source observation. Prior odds_changed_at/last_seen_at/wire_received_at fields were removed. A fresh timestamp alone is insufficient price freshness proof.
- https://docs.sharpapi.io/en/concepts/market-lifecycle/ — is_active=false is frozen/unbettable; removal means absence from the next snapshot; missing is_active is documented as true. This documented default still requires a complete genuine response, reviewed mapping and version-specific authority; no default was fabricated here.
- https://docs.sharpapi.io/en/api-reference/odds/ — native row identity/selection/price fields and pagination; headers include request ID/data delay. A single page cannot establish complete coverage when has_more is true.
- https://docs.sharpapi.io/en/pricing/ — published free tier $0/month, two books, 12 requests/minute, 60-second delay. This is a public offer, not verified FBIS account entitlement or preservation rights.

The Odds API official https://the-odds-api.com/liveapi/guides/v4/ documents market last_update as the time its system last saw bookmaker market odds. This is provider observation, not a bookmaker-native price-change clock. Suspended/closed markets may remain in responses for about15minutes with a nonadvancing timestamp. Presence in a response alone cannot prove OPEN/executable status.

Economic fit: full-game NFL/CFB spreads, moneyline and totals overlap existing model outputs; Phase2 situational contract currently supports full-game selected-team spreads only. Do not expand it to moneyline/totals in this phase. DraftKings/FanDuel could be execution-relevant if accessible to the operator, but actual jurisdiction/account availability and honored prices are unverified. Pinnacle can be a reference benchmark without being an executable operator offer. Current candidate frequency, rejection rate, source latency, valid same-book closing coverage and incremental incumbent benefit are UNKNOWN.

Actual FBIS marginal acquisition cost, current subscription, storage footprint, engineering cost and preservation rights are UNKNOWN. No requests were added, but this does not verify the costs of future reuse. Without native bytes, even storage bytes per capture cannot be measured. Do not estimate these costs as facts. Reject further SharpAPI original-clock mapping effort absent independently sufficient source evidence; defer any production modification. Test The Odds API only with an already-existing export and receipt. Do not buy historical data, upgrade plans or introduce blended sources.

## Availability-only evidence and required independent decision

An independently timed receipt could prove that an exact provider-delivered price was available to FBIS no later than acquisition for a later decision. That is capture-time evidence, not original bookmaker observation or guaranteed executability. It remains Class B under Phase3; current Phase2 rejects the missing original clock. Creating a separate acquisition-only benchmark contract would change research eligibility semantics and requires independent decision. No contract was weakened. With no genuine receipt, even that narrower evidence claim cannot be made for this source.

Required decision inputs: one complete genuine response with receipt/hash, source semantics, documented OPEN interpretation at the decision, preserved rights and account costs. If the feed cannot establish source observation, decide whether a separately labeled reference-only benchmark has sufficient economic value; do not present it as executable-price or original-clock evidence.

## Validation scope and STOP

New tests use synthetic counterexamples: a fully valid control prevents a rejection test passing merely because its fixture is malformed; feed-refresh/acquisition/unknown clock semantics then fail the real Phase2 gate. A production-normalizer counterexample demonstrates that parseable prices lose clocks and suspension state and cannot supply research provenance. It deliberately documents existing display behavior, not approval of suspended betting markets. No production change fixes or activates that path.

Existing Phase2/3 tests cover missing clocks, late receipt, wrong event/book/side/sign/period, invalid prices, partial raw mappings, tampering, duplicates, post-kickoff data, sealed-candidate mutation, provider blocking and authority activation. A genuine-source parsing acceptance test cannot be supplied without genuine source evidence. No synthetic fixture is counted toward the mandatory one-real-quote GO.

Run focused native plus existing situational tests, full suite, syntax, build, migration and diff checks. Independent review and hosted CI must bind the final draft HEAD. No production hook proposal is issued because the evidence gate failed; precise modifications, storage estimates and activation plan would be premature. Stop production capture, merge/deploy and economic evaluation. Deliver the smallest next evidence-access request rather than a larger implementation.
