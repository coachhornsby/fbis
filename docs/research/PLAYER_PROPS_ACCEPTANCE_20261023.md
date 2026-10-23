# Player props acceptance audit — 2026-10-23

## Scope and evidence

Repository: coachhornsby/fbis. Production D1 and R2 read through the connected Cloudflare account. Baseline measurements below are observations, not wagers, guarantees, or newly granted model permissions.

Production sources inspected: sport-owned NBA/NFL/NHL D1; primary MLB D1; the Kalshi 4,045-series catalog and captured prop snapshots; daily NBA SDV/ESPN history; immutable official-result and forecast evidence prefixes. The uploaded ZIP was inventoried (237 entries); its historical February files are not current player availability or contract evidence.

The current browser is on a school network that blocks fbis-myz.pages.dev. No attempt was made to bypass that filter. Browser visual verification remains blocked; source, rendering, API integration, production-storage replays, and release checks are used instead.

## Measured baseline

| Sport | Captured exchange coverage | Data verified | Remaining source/validation limits |
|---|---|---|---|
| NBA | Five original Kalshi stat series; Polymarket Gamma stat references | 12 fixtures today; 651 roster profiles; 1,340 raw D1 projection rows across five stats (before deduplication); history snapshot 543 players, 500 with five games, 43 with one to four | Gamma reference prices are not executable orderbook asks; exact exchange threshold calibration not established; some model inputs are stale |
| NFL | Four original Kalshi stat series | 3,223 current roster profiles in NFL owner; upcoming fixtures on Oct 25/26/29 | Receiving-yard snapshot hit 1,000 rows with pagination incomplete; historical probabilities are not automatic exchange settlement validation |
| NHL | Points; saves captured with zero open records at observation time | 841 current player profiles; two fixtures today; 196 official result evidence objects | No frozen projection or settlement-grade objects in original evidence archive; some configured series are absent from catalog |
| MLB | Hits 33; home runs 19; pitcher outs 2 | One fixture today; 1,362 roster profiles; all 54 captured contracts replay-map after fix, versus zero under old mapper | Snapshot age is still enforced; broader MLB validation artifact is not attached; starting-lineup/fair-price semantics differ from void-on-DNP rules |
| WNBA | Three captured series, zero open records at observation time | Upcoming fixture observed Oct 24 | No implemented exact roster adapter in shared prop research loader; no current captured exchange contracts |
| CFB, CBB | No exact exchange-prop adapters in this path | Team/model systems exist separately | Need source-backed player/stat/contract adapters and roster links before exchange completeness can be certified |
| Tennis, soccer, NPB, KBO | No exact exchange-prop adapters in this path | Sport systems exist separately | Need supported contract discovery, exact identity, stat definition, and settlement adapters; generic sport-filter support does not establish prop coverage |

The MLB replay is saved in `docs/research/player-props-mlb-mapping-20261023.json`. It validates mapping, not freshness or executable prices. Home-run snapshots observed during the audit were already older than the two-hour read window and must not become current prices.

## Repairs

- Route all-sport and player-details fixture/roster reads through the currently approved sport owner. Refuse unapproved sport-mode fallback. Normalize verified NBA and NHL abbreviation aliases only after exact fixture lookup.
- Parse observed MLB `records`/`has`, optional `the`, professional-baseball wording, and explicit EDT/EST start times. Require time equality when rules supply a time, retaining doubleheader ambiguity rejection. Accept observed professional-football wording.
- Follow Kalshi pagination with bounded pages, overlapping-ticker deduplication, repeated-cursor protection, honest partial receipts, and rate-limit cursor retention. Increase selected series to six per collector opportunity to keep expanded discovered inventory within the existing two-hour window.
- Add catalog-confirmed MLB KXMLBKS, NHL assists/save alias, and NBA PR/PA/RA stat families. Do not treat season totals, ladders, protected contracts, or goalscorer templates as ordinary numeric game props.
- Derive NBA two-stat means only from exact same-player/event/model-version/input-cutoff component projections. Expected means add; joint sigma/probability is left absent instead of inventing covariance.
- Remove the eight-game Gamma slate cap (bounded to 32) and continue collecting other fixtures when an individual event is absent. Preserve missing-event errors in the receipt.
- Preserve per-player model version and actual source feature clocks. Do not replace absent input clocks with request time. Exclude explicitly unavailable players. Prop API rows carry a data-acceptance result; the exchange card selector withholds failed rows and the operator report records why.
- Read NBA/MLB `profile_json` as well as NFL/NHL `raw_json`; expose available rotation role, minutes, bats/throws, expected innings/PA, and source timestamps. Add workload summaries with units. Label partial current-season samples as samples.
- Permit intended forecast-freeze and grade-reconcile scopes in the existing authenticated service relay; arbitrary scopes and financial writes remain blocked.
- Freeze every eligible forecast for each event in immutable, hash-verified R2 event batches. This removes first-32/50-row starvation without per-player R2 request fanout. Rotate NBA/NFL/NHL/MLB captures each quarter-hour, selecting the nearest upcoming fixture date within seven days.
- Read frozen forecasts and existing official NHL result evidence by exact identity, stat, period, and event start. Show forecast error only after an official final/played result joins the pregame record. No past forecast is backfilled and no P&L is inferred.

## Repeatable acceptance surface

`GET /api/prop-acceptance?sport=nba&date=2026-10-23` reports model counts, metadata-ready counts, withheld model reasons, matched/unmatched contracts, source failures, collection coverage, and history-check state. The report is separate from the main board.

`node scripts/audit-prop-acceptance.mjs YYYY-MM-DD [comma-separated sports]` saves the JSON report. The **Player props production acceptance audit** workflow runs it from GitHub and preserves the artifact. Run NFL on its upcoming game date as well as the current date.

The endpoint's `DISPLAY_METADATA_COMPLETE` status means exactly that. It does not certify last-five history, injuries, price execution, calibration, or profitability. Histories not fetched for the specific row are `NOT_CHECKED`, never passed by assumption. Missing history is not padded with zeroes; players with fewer than five games keep the real sample.

Model-input age limits are explicit: MLB 14 hours; NHL 24 hours; NBA/WNBA/CBB 72 hours; NFL/CFB 192 hours. They control display acceptance only, not wager qualification. Missing or future input clocks fail acceptance.

## Completion limits

This release repairs verifiable delivery, identity, metadata, collection, and prospective recording defects. It does **not** claim all sports are complete. The remaining six sport adapters, full-season coverage where only short snapshots exist, verified execution/fee inputs, broad official-result adapters beyond NHL, and prospective threshold-calibration samples still require source-backed evidence. Forecast-error cohorts are separated by sport, stat, and model version; hit frequency does not become a calibrated probability and simulated outcomes do not become user profit.

## Verification

Regression coverage includes real MLB rule formats, doubleheader time rejection, cursor pagination/overlap, partial receipts, approved all-sport owner routing, exact model identity, stale/future/missing input clocks, unavailable players, immutable full-event freezes beyond 32 rows, corruption detection, signed relay scopes, and official-result joins without invented profit. Production build and release check results are recorded in the PR.
