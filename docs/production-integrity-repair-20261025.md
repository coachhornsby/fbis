# Production integrity repair — 2026-10-25

## Verified baseline

Repository and Pages production both reported `3216d1729c22293653f1e0f25eb08ffef81507a4` at inspection. Pages deployment `2f855ed9-4705-4cde-9c4d-5c2de5e84067` succeeded at 13:34:47Z.

Production has seven Workers. Pages binds every sport D1, CORE, OPERATIONS, three market-history databases, PRIMARY, cold history and the existing R2 `fbis-archive` bucket. NFL/NBA/CFB/NHL use sport mode; other sport bindings remain in shadow mode. This change does not perform or claim another cutover.

The legacy market ledger is physically full (9,999,998,976 bytes). The Q4 shard was 9,109,897,216 bytes and Q4B was 1,298,644,992 bytes at inspection. Q4B has October 25 PinnOdds and Polymarket observations; a stale legacy table is not proof of a dead feed.

## Repairs

- `functions/lib/exchangePlayerProps.js`: historical snapshot classifications and missing source outcome identifiers cannot yield current purchase asks or market availability. Their observed reference values remain available. No source clock is rewritten.
- `functions/lib/fbisFrozenModelDelivery.js`: reject future freeze timestamps, wrong player-provider namespaces and content-addressed objects whose event differs from their index receipt. Existing SHA-256 verification remains in force. Add exact identity merge for independently stored copies.
- `functions/api/prop-projections.js`: merge R2 and NBA sport-D1 freezes by sport/event/player/stat/period. Previously, both copies could enter the result after tipoff and make the frontend's exact-one-model join ambiguous. Preserve the preferred source, other stats and unresolved source-level ambiguity.
- `scripts/lib/fbisAutoRepairPolicy.mjs`: the existing watchdog now pairs opposing spread signs rather than absolute line values. Missing/negative total thresholds cannot pass. Historical, suspended, inactive, expired and closed observations cannot pass current-quote checks. Existing per-family diagnostics and incident reconciliation consume these stricter findings.
- Regression coverage added to the three existing test files. No new production pipeline or database.

## Before and after

| System | Baseline | Result of this bounded repair | Verification |
|---|---|---|---|
| Quote provenance | Historical exchange snapshots could pass with recently collected clocks | Historical snapshots and missing outcomes blocked | Regression tests; production source audit separately recorded below |
| Tennis references | 126 missing source market IDs in PRIMARY | No fabricated corrections; 126 unresolved | ATP 40 per ML/spread/total; WTA 2 per family; Q4/Q4B query returned no such rows |
| NFL contracts | Earlier acceptance audit request failed | Public projection read works; complete contract reconciliation remains unresolved | Browser API: 536 rows, 461 display-ready, 38 identity gaps and 37 started-event rows |
| NBA contracts | 14,125 private projection rows; zero legacy comparison rows | Empty legacy table not treated as zero frontend comparisons | Production acceptance run: 3,489 contracts, 2,891 matched, 1,192 models, 816 display-ready |
| Model delivery | Cross-store frozen duplicates possible after start | Exact source copies merge to one identity | Source-hash, namespace, future-clock and merge tests |
| Moneyline | Separate current-family checks already exist | Existing behavior retained | Existing family and soccer 1X2 tests |
| Spread | Same-sign home/away handicaps could pass watchdog | Opposite-sign requirement | Regression: +3.5/+3.5 rejected; -3.5/+3.5 accepted |
| Total | Missing line could become zero; negative total used absolute value | Missing/nonpositive thresholds rejected | Null, empty and negative total tests |

## Source evidence and unresolved failures

1. PRIMARY contains the 126 tennis consensus records (120 ATP, 6 WTA), dated October 7. Retained normalized payload sample has ACTION_APIFY provider event identity and a consensus/quality summary, with no source market identifier. Private tennis D1 contains 204 historical snapshots. The sample private payload is likewise consensus/quality only. No identifier recovery is claimed; full retained raw archive investigation remains outstanding. Keep these records excluded; do not manufacture an ID from event/family or price.
2. All sampled October 25 Q4B PinnOdds game-family groups have source-market IDs, outcome IDs, hashes and numeric prices, but NULL `source_observed_at`. These are collection-timed references, not proof of a provider-timed live executable quote. Preserve that distinction. Provider documentation/source payload support is needed before filling a clock.
3. Polymarket US WebSocket records have source clocks and IDs/hashes. At inspection, NBA/soccer source clocks reached 14:18Z. Some rows have no numeric price: do not fill them from another quote or assume suspension state. REST and WS clocks/price availability must be checked independently.
4. NBA `nba_prop_comparisons` has no active application writer outside working-copy inventory. The current card path joins independent projections and exchange contracts rather than consuming that table. Backfilling this table would not itself repair cards. Acceptance run 40198302931 demonstrates existing matches and remaining gaps; no comparison-table insert was performed.
5. Forecast date indexes are independently readable in R2: NFL lists 12 event receipts, NBA 7. NFL event 401873017's immutable object is independently retrievable and contains 31 forecasts. The acceptance job captured 461 NFL forecasts (38 blocked for identity) and 816 NBA forecasts (80 blocked for identity, 296 stale). Do not rely on old capture totals as current display coverage.
6. Production acceptance run 40198302931 failed because NFL's read failed, despite successful captures. The existing all-sport watchdog run 40198302907 succeeded as an incident-management workflow; that does not mean all market coverage passed. Football SDV history run 40199519945 also failed. Its root cause is not repaired by this patch.
7. Live browser NFL board loaded 12 games and five distinct top players with model direction. Example: Bijan Robinson receiving yards 21.8 versus Kalshi 24.5, under lean. Initial last-five sections were still loading. MLB filter showed zero games. Neither observation proves every sport/API/card is complete.
8. Direct shell requests to FBIS returned HTTP 403 in this environment; browser reads and Cloudflare/GitHub connectors supplied production evidence. NFL exchange API navigation timed out; no complete current NFL contract count is claimed from that attempt.

## Validation and release

Local validation: 74 focused tests passed; `npm test` completed 2,205 tests with zero failures and zero skips. Build passed. Migration verification covered 141 migrations / 305 tables and the canonical tip 0126. Cloudflare static configuration passed. Deployment and post-release inspection must be recorded separately after CI; a local build is not deployment proof.

No production SQL writes, destructive migrations, new paid provider requests, model coefficient/champion changes, qualification promotions or wagering authority changes. There is no demonstrated ROI or accuracy improvement. The direct benefit is stricter evidence handling and removal of an ambiguous delivery join.

Next highest-value work: complete current NFL contract acceptance and per-sport source-backed fixture/market matrices, then recover any tennis references available in full raw archives. Preserve separate source-clock, exact-contract, model-freshness and economic-qualification results.
