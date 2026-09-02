# Phase 1 — MLB full-game contract

Phase 1 is MLB full-game moneyline, run line, and total only. F5, player props, CFB, CBB, NFL, and NBA may remain visible as research-only or unavailable surfaces. They are not production-qualified in this phase.

Champion model weights, projection formulas, qualification thresholds, qualification-rule versions, and historical ticket membership are not changed by this pass.

## Canonical event identity

Every MLB record uses:

- MLB game ID / GamePk
- Operator date in America/Chicago
- Scheduled start UTC
- Away team ID
- Home team ID
- Venue ID
- Starting pitchers when available

Match order:

1. Canonical game ID
2. Canonical team IDs plus a 3-hour start-time tolerance
3. Explicit reviewed alias mapping

Do not match solely on abbreviations or display names. Ambiguous or conflicting events fail closed (`AMBIGUOUS` / `CONFLICT`). SYS matching-health counts use `MATCHED` / `UNMATCHED` / `AMBIGUOUS` / `CONFLICT`.

## Canonical markets

- `MLB:FULL_GAME:MONEYLINE`
- `MLB:FULL_GAME:RUN_LINE`
- `MLB:FULL_GAME:TOTAL`

F5 is not full game. Team total is not game total. Alternate run lines are not the standard run line. Player props are not game markets. Model fair, Kalshi sentiment, and Ballpark Pal probability are not sportsbook prices. Heritage current line is not Pinnacle close.

## Source roles

| Source | Role |
|---|---|
| Heritage | Actual operator execution |
| Pinnacle | Benchmark, no-vig probability, close for CLV |
| Ballpark Pal | Matchup, lineup, park, projected runs, F5 analytical context |
| Savant | Pitcher/batter and run-environment analytical inputs |
| Kalshi | Sentiment only |
| Parlay / other feed | Market aggregation only, documented identity |

Every displayed external value includes source and as-of time in expanded game details.

## Projection inputs (full-game team runs)

Implemented engine: Savant + Ballpark Pal overlay (`functions/lib/slateEngine.js`). Missing values are not fabricated as zero.

| Input | Source | Required | Imputed | Affects qualification | Before start |
|---|---|---|---|---|---|
| Starting pitcher | Pal / MLB Stats | no | no | no | yes |
| Starter handedness | Pal / Savant | no | no | no | yes |
| Expected innings / TTO | Savant / Pal | no | no | no | yes |
| Bullpen quality / availability | Pal | no | no | no | yes |
| Bullpen recent workload | Pal | no | no | no | yes |
| Confirmed or projected lineup | Pal | no | no | no | yes |
| Platoon splits | Savant | no | no | no | yes |
| Park factors | Pal | no | no | no | yes |
| Weather / wind / temperature / humidity / roof | MLB Stats / Pal | no | no | no | yes |
| Umpire | optional feed | no | no | no | yes if present |
| Team offensive strength | Savant / FBIS | yes | no | yes | yes |
| Recent form (regressed) | FBIS / Savant | no | no | no | yes |
| Travel / rest | schedule | no | no | no | yes |
| Ballpark Pal overlay | Pal | no | no | no | yes |
| Savant inputs | Savant | no | no | no | yes |

If spread/total probability is not independently frozen, that market is not reconstructed and is not calculated-performance eligible.

## Qualification labels

`CONVICTION` · `QUALIFIED` · `MODEL LEAN` · `MARKET UNAVAILABLE` · `PROJECTION INCOMPLETE` · `QUALIFICATION PAUSED` · `CANARY`

CONVICTION is displayed only when every CONVICTION gate passes. While probability integrity verification is pending, the pause remains in force.

Canary tickets use strategy `FBIS-CANARY-PROB-v1` and tag `CANARY`. They never enter FBIS-HC-v1 performance.

## Execution attribution

Importing a Heritage bet never makes it an FBIS recommendation. Attribution requires the same event, market family, period, selection, line where relevant, freeze before execution, execution after freeze and before start, and matching qualification-rule version. Otherwise: `OPERATOR BET · NOT ATTRIBUTED TO FBIS`.

## Settlement

- MLB moneyline cannot push.
- Half-point run line or total cannot push.
- Whole-number run line or total may push only when the result lands exactly.
- Missing final remains unresolved.
- Already-settled wagers require a correction audit record, not a silent overwrite.

## CLV

Same event, market, period, selection, and line. Statuses: `PRICE_CLV_SAME_LINE`, `LINE_MOVEMENT`, `MISSING_ENTRY`, `MISSING_CLOSE`, `LINE_MISMATCH`, `UNMATCHED_CONTRACT`. Heritage current-line movement is not Pinnacle CLV.

## Populations

Never mix all frozen projections, qualified recommendations, CONVICTION tickets, CANARY tickets, imported Heritage bets, operator-only bets, moneylines, run lines, totals, model versions, qualification versions, or checkpoints. Every displayed statistic includes a population descriptor.

## Acceptance period

Phase 1 is not complete after one successful run. Several consecutive operational days must demonstrate scheduled collect, scheduled harvest, durable D1 rows, settled Heritage finals, no cross-sport contamination, no indefinite loading, persisted probability on qualified tickets, recomputed Expected ROI, correct grading, valid CLV contracts, and SHA parity.
