# FBIS Underdog market-data integration

Status: market-data infrastructure only. This integration cannot qualify a market, change projection math, change thresholds, or authorize a wager.

## Source
FBIS requests `https://api.underdogfantasy.com/beta/v3/over_under_lines` through `functions/lib/underdogClient.js`. The endpoint is unofficial/undocumented and can change or disappear without notice. No API key is currently used. Availability, access policy, Terms of Service, and schema stability must be treated as external reliability risks.

The client uses an explicit FBIS user agent, an 8-second timeout, a 20-second in-process cache, structured errors, and schema diagnostics. Non-200 responses, malformed JSON, missing top-level collections, invalid line values, unresolved identities, duplicate/conflicting lines, suspiciously small feeds, and unknown schema versions produce warnings. Rows with unresolved player/appearance identity are not eligible for automated comparison.

## Normalized row
Each row retains: platform/source, sport, league, player name/id, team/opponent, event id/start, raw stat label, canonical stat family, line, over/under availability, payout multiplier when exposed, line type, alternate/promo flag, raw source ids, observation timestamp, usability state/reasons, and raw source objects in debug/internal form.

Line type is one of `standard`, `alternate`, `promo`, `discounted`, or `unknown`. Unknown is intentional: FBIS does not infer a standard line when the source does not prove it.

## Supported exact stat mappings
- Tennis: Aces, Double Faults, Total Games, Games/Total Games Won, Sets/Total Sets, Break Points Won, Fantasy Score.
- NFL: Passing Yards, Rushing Yards, Receiving Yards. Rush + Receiving and Pass + Rushing are normalized for source compatibility but are marked model-unsupported because current production FBIS canonical NFL model families do not include those combined markets.
- MLB: Hits, Total Bases, Home Runs, Runs, RBI, H+R+RBI, Pitcher Strikeouts, Fantasy Score.
- NBA/WNBA: Points, Rebounds, Assists, PRA, 3PM, Steals, Blocks, Turnovers, Fantasy Score. Fantasy Score is retained as a normalized source family but current production NBA/WNBA canonical model support does not authorize it.
- CS2: Maps 1+2 Kills and Maps 1+2 Headshots are defined in the shared mapping layer.

Only exact/verified labels are mapped. Similar labels are not assumed to share settlement semantics.

## API
`GET /api/lines/underdog` supports `sport`, `league`, `statFamily` (or `stat`), `player`, `event`, and `date`. `debug=1` includes raw/schema diagnostics. `archive=1` writes an append-only R2 snapshot when the ARCHIVE binding exists.

The public response explicitly sets `decisionEligible=false`, `canQualify=false`, and `canAuthorizeWager=false`.

## Logging
`archiveUnderdogSnapshot` writes immutable timestamp-keyed observations under `raw/underdog/<sport>/...`. It never overwrites a prior observation. Snapshot rows retain timestamp, platform, sport, event, player, stat/stat family, line, line type, source ids, and event start time for future CLV and line-movement work.

## Cross-platform comparison
`functions/lib/marketLineComparison.js` compares equivalent normalized player props and reports lowest over threshold, highest under threshold, disagreement, staleness/outlier flags, and timestamp spread. Its governance label is `MARKET_SHOPPING_ONLY`; a lower/higher threshold is not a bet signal.

## Production-repository audit (2026-10-07)
Current production `main` at the start of this work was `ee715fe9d87e018f92288f8f9a8fa10a641d28d0`.

The requested legacy examples `api/cs2/lines.mjs`, `api/CS2/lineLogger.mjs`, `api/CS2/underdogLogger.mjs`, and `lib/nfl/nflLineAdapters.js` are not present anywhere in the current production tree. Repository code search and the current tree also contain no existing Underdog endpoint/parser implementation. Therefore no legacy CS2/NFL parser was deleted or behavior-replaced in this change. CS2 compatibility mappings are covered by fixtures/tests; a true migration requires the missing legacy source to be restored or identified.

Existing adjacent market infrastructure includes PrizePicks ingestion in `functions/api/prizepicks-props.js`, canonical sport/stat mapping in `functions/lib/proPlayerProps.js`, Tennis derivative modeling in `functions/lib/tennisPlayerPropModel.js`, and the player-props board in `src/features/playerProps/PrizePicksMarketPanel.jsx`.

Tennis now requests Underdog alongside the existing projected PrizePicks rows and displays a matched Underdog threshold plus line delta/timestamp. Promo/discounted/alternate Underdog rows are excluded from that standard comparison. If the source cannot prove standard status, an `unknown` line may be displayed as source-unknown rather than promoted to standard. Underdog payout economics are not used for authorization.

## Adding a sport
1. Add only exact source-label mappings to `underdogStatMaps.js`.
2. Mark a family model-supported only when the production sport model already understands identical settlement semantics.
3. Add fixture coverage for the raw label and line variant.
4. Keep source normalization separate from projection/governance code.
5. Do not add a new wager venue or qualification path as part of ingestion work.

## Reliability / ToS caveat
This is an unofficial, undocumented feed. It can change without notice, reject automated clients, omit entities, alter settlement labels, or expose variants differently. FBIS must fail open at the board level and fail closed for automated comparison when identity/schema integrity is not established. Manual line entry and existing PrizePicks/sportsbook paths remain independent fallbacks.
