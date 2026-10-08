# ACTION temporal integrity — bounded Phase 2A

Base: `6a2e90b47be57b7f3d565a14d40056a0646909d2`. Production Pages matched this SHA before work. This branch contains input-validity corrections and tests only. No merge, deployment, D1/R2 mutation, paid acquisition, historical publication, policy/reservation change, model promotion, coefficient/threshold/authority change is part of this work.

## Root causes and correction

NFL `buildNflWagerIntelligence` read consensus/history before Today display sanitation, so derived current spread/total/edge fields survived after actionIntel disappeared. Validate input at the derivation entry point and common attachment; require a valid current terminal history observation before old opening context participates. Valid historical opening observations retain original times and an explicit historical label.

NBA `summarizeActionForDecision` applied only an upper time cutoff, without an age ceiling or reliable acquisition timestamp. Validate acquisition and supplied provider observation times before summary calculations. A separate owned-market trajectory freshness contract remains untouched. The production caller includes `scripts/nba-game-decision-evaluate.mjs`, which supplies historical decisionAt for point-in-time evaluation; compare evidence to that clock, not today's clock.

Tennis `latestActionRows` compared ISO `T` timestamps to SQLite `datetime()` text with a space. The exact baseline SQL, with a fixed clock, admits stale same-day data and future records. Use `julianday` lower/upper bounds and chronological ranking, plus strict source timestamp validation. Preserve the existing default eight-hour research lookback (bounded 1–48 hours); it is not a current-market freshness contract. Current ACTION auto decisions and ACTION quotes in the packet route must meet the existing 600-second current-use source ceiling before simulation/market residual derivation. Preserve non-ACTION quotes and original capture/observation times.

Common board normalization formerly substituted observed, scraped, or created timestamps for missing acquisition time. It now retains collected_at and source_observed_at separately. `attachActionIntelToGames` validates every attachment, including Today's separate reattachment before NHL evaluation. Slate sanitation also covers preattached inputs and attachment failure paths before downstream decisioning.

The direct WNBA canonical-row loader bypasses common attachment. The trace confirmed it feeds trajectory/overlay calculations without a source age bound. Restrict that reader's inputs with the same predicate; retain owned odds, model and decision formulas.

## Temporal contract

- Current ACTION acquisition age: 0–600 seconds inclusive. Clock-skew allowance: zero, matching the previous display rule. No policy changes.
- Require acquisition time. Archive/publication/current-request time cannot replace it.
- Accept zoned ISO timestamps and SQLite's documented UTC timestamp format. Reject date-only, unzoned ISO, malformed/overflow, missing and future timestamps.
- When provider time exists, it must be valid, within the applicable age window, and not later than acquisition. Preserve absent provider time as unknown; never create one.
- Exclude CLOSE and future/malformed history from decision inputs. Old historical research remains separately labeled; no historical database content changes.
- Unavailable comparisons remain null/absent. Independent projection and valid non-ACTION executable prices stay intact.

## Consumer coverage matrix

| Path | Classification before repair | Coverage / remaining limit |
|---|---|---|
| Adapters → raw R2 → shadow/canonical storage | Historical retention; not applicable to current filtering | Unchanged; no recovery or publication |
| Board durable series, legacy fallback, exact/rematched identities | Confirmed missing input validity | Common attachment filter; original acquisition time required |
| Slate → projection export / product serialization | Confirmed display-filter bypass | Sanitize attachment/preattached inputs before derivation |
| NFL wager intelligence and decisions | Confirmed defective | Direct derivation guard; current history requirement; independent EV and authority untouched |
| NBA evaluation script → ACTION summary/confidence | Confirmed defective | Validate against explicit decisionAt before summary; owned-market trajectory unchanged |
| Tennis raw research-window query | Confirmed defective timestamp comparison | Chronological SQL upper/lower bounds and strict validation; eight-hour default retained |
| Tennis auto and packet ACTION market/context inputs | Confirmed no current source validity check | Validate before prior/residual derivation; non-ACTION inputs unchanged |
| NHL slate and Today reattachment → trajectory/reliability/candidates | Confirmed shared input exposure | Shared attachment/slate sanitation; owned marketLineHistory retained; no NHL math change |
| NHL exported trajectory helper used directly | Potentially vulnerable if future callers bypass source boundary | Current repository production callers traced to sanitized Slate/Today; pure research helper unchanged |
| WNBA direct DB loader → trajectory/public overlay | Confirmed defective bypass | Reader filters before derivation; owned odds unaffected |
| CFB / MLB / Soccer / CBB shared current boards | Shared attachment exposure | Shared source boundary covers attached ACTION; pure sport models unchanged |
| `actionMarketIntelligence::buildActionMispriceRows` → `/api/misprices` | Confirmed separate missing/future timestamp acceptance | **Deferred**; six-hour misprice contract and stored snapshot fallback differ. Needs separately bounded follow-up. No platform-wide clearance claimed |
| Historical ACTION evaluation/replay scripts | Not current-use authority | Unchanged; no workflow replay requested or dispatched |
| Tennis saved research snapshots / manual canonical misprice snapshots | Unverified current serialization semantics | New derivation guards do not rewrite cached/historical packets; audit labeling and current-use consumers separately |
| Direct display filtering / authority gates | Previously protected direct fields / authority | Keep final filtering and immutable authority flags; they cannot replace input checks |

The misprices API needs a separate scope decision: strict missing/future rejection plus original timestamp reconciliation for persisted snapshots, without changing its six-hour research contract into the board's ten-minute rule. This PR does not silently broaden into a snapshot/publication refactor.

## Files and validation

Shared predicate: `functions/lib/actionTemporalValidity.js`.
Consumers: `actionDisplayFreshness.js`, `boardActionIntel.js`, `slateEngine.js`, `nflWagerDecision.js`, `nbaWagerDecision.js`, `wnbaWagerDecision.js`, and `functions/api/tennis-v2-snapshot.js`.
Tests: new `test/action-temporal-integrity.test.js`; fixed-clock/provenance fixtures in NFL/NBA/board durable/board attachment/Tennis event-integrity tests. `package.json` includes these new regressions and NFL/NBA/WNBA decision tests in standard CI.

The previous NFL test titled “ACTION confirmation cannot create a bet when independent EV is non-positive” actually offered positive independent EV on the away side. Correct its fixture to zero spread/matching total with -110 prices on all sides, so its assertion tests non-positive EV. No production price math or qualification rule changes.

Before: NFL stale consensus survived; NBA stale row accepted; exact Tennis baseline SQL accepted stale and future rows. The initial focused test run failed before changes. After: deterministic fixed-clock cases cover fresh/boundary/expired/missing/malformed/overflow/future/UTC/offset values, provenance separation, current vs historical use, actual SQLite query execution, NFL/NBA contamination, WNBA bypass, source time after capture, ACTION Tennis quotes and valid unrelated markets.

Local verification on the final code:

- `npm test`: **1,325 passed, zero failed**. An earlier run had two live Open-Meteo network failures; unchanged tests passed on the later complete run. Logs retain both outcomes.
- Focused sport/governance/attachment suite: **120 passed**, zero failed.
- `node --test test/action-temporal-integrity.test.js test/action-display-freshness.test.js`: **27 passed**, zero failed.
- `npm run verify:migrations`: pass, 112 migrations / 266 tables verified; no migrations added.
- Every Cloudflare function: `node --check` pass.
- `npm run build`: pass; existing large-chunk warning remains.
- `git diff --check`: pass.
- No repository lint or typecheck script exists. CI's declared gates are migration verification, function syntax, npm test and Vite build. Local Node is v24.19.0; hosted CI uses Node 22 and must pass before deployment authorization.

## Deployment prerequisites and acceptance

**Review-ready; production deployment is not authorized.** Required hosted CI must be green at the exact PR head. Confirm no main/production drift; resolve or explicitly accept the deferred misprices/cached-snapshot boundary before claiming cross-platform temporal integrity. Keep ACTION/PrizePicks BLOCKED.

After separate authorization, use the existing validated release path at the approved exact SHA. No schema changes or historical recovery operations are required by this patch. Existing release automation has migration bookkeeping and secret synchronization steps; their production writes require deployment authorization, which this run does not provide. Do not dispatch it for validation.

Before deployment, record main/PR head, Pages production SHA/deployment ID, policy/reservation state, current source timestamps and representative public response content. Re-run declared gates on exact head. Avoid production API GETs that write decision snapshots during a read-only acceptance preview.

After authorized deployment, compare Pages SHA with approved SHA and inspect actual response content:

1. `/api/today` NFL/NHL/CFB/MLB/Soccer boards must lack expired ACTION current lines, public/trajectory context and derived stale comparisons. Preserve real owned executable prices and model outputs. Inspect mobile cards as well as JSON.
2. `/api/projections` must not retain stale ACTION-derived comparison packets through the display-filter bypass. This endpoint can persist snapshots; call only within separately authorized production acceptance.
3. NBA evaluation fixtures must retain valid contemporary ACTION at an explicit decisionAt and reject stale/missing/future rows. Do not run paid acquisition or historical ingestion to produce examples.
4. Tennis reader fixtures prove chrono semantics. Inspect existing current research snapshots without restamping/republication. Do not POST production snapshot generation merely to create validation evidence.
5. During the source outage, missing current ACTION is the correct outcome. Fresh positive-path proof comes from deterministic fixtures; later natural acquisition may provide prospective production evidence after separately governed source restoration.
6. Verify source policies remain BLOCKED and reservation unchanged; compare original captured/source timestamps, not archive/publication time.

Read-only SQL templates (never apply schema/write operations):

```sql
SELECT source,state,reason,freshness_seconds,updated_at
FROM external_acquisition_policy WHERE source IN ('action','prizepicks');
SELECT ct_date,run_id,state,estimated_cost_usd,actual_cost_usd,completed_at
FROM prizepicks_daily_acquisitions WHERE run_id='pp_20261007_37673437008';
SELECT canonical_event_id,sport,provider_timestamp,collected_at,snapshot_type
FROM action_market_book_observations
ORDER BY collected_at DESC LIMIT 50;
SELECT id,run_id,sport,fbis_event_id,source_observed_at,collected_at
FROM shadow_market_observations ORDER BY collected_at DESC LIMIT 50;
```

Compare API packet values and lineage against these original timestamps. HTTP 200 alone is insufficient. Do not weaken release health, acquisition blocks or wager authority to pass acceptance.

## Rollback

No data rollback is needed: this is code-only. On separately authorized production failure, redeploy the previously verified immutable Pages artifact/deployment `50f3fcca-7f86-42f2-81b0-5752507df8ec` at baseline SHA, or revert this bounded commit and use the repaired release path. Confirm matching Pages SHA, mobile rendering, API content and unchanged policy/reservation state. Leave canonical history intact; never replay acquisition, restamp captures, clear reservations, or roll back database contents. Reverting restores the known stale-input defect, so record that limitation and keep paid policies blocked.

## Final hardening review — 2026-10-08

The original `Date.UTC(year, month, 0)` calendar check maps years 0–99 to 1900–1999. Year 0000 leap day was rejected incorrectly. Gregorian arithmetic now validates the actual year. Date.parse also truncated nonzero fractional precision beyond milliseconds, allowing `.0001Z` to compare equal to the clock. Such unrepresentable timestamps now fail closed; trailing zero precision remains accepted. Numeric clocks must be integer milliseconds inside the JavaScript Date range.

Offset validation follows the existing ECMAScript grammar (00–23 hours, 00–59 minutes), rather than inventing a narrower geographic-zone policy. +24:00 and minute 60 fail closed. Source observation time remains optional where the capture does not supply it; missing acquisition time remains invalid. No archive/created time substitutes for acquisition time. Fixed-clock hardening tests cover calendar, offsets, precision, boundaries and clock overflow.

Review gate: bounded code may proceed to independent review. Production deployment remains unauthorized; Phase 2B alternate consumers require their own review.
