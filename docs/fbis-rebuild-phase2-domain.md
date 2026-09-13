# FBIS Rebuild — Phase 2 Checkpoint (domain contracts)

**Branch:** `cursor/fbis-rebuild-phase1-2-312d`  
**Depends on:** Phase 1 checkpoint (`docs/fbis-rebuild-phase1-checkpoint.md`)

## Delivered

| Item | Path |
| --- | --- |
| Event / Market / PlayerMarket contracts | `functions/lib/fbisDomain.js` |
| Decision-state derivation (no invented qualification) | `deriveDecisionState` |
| Today domain board mapper | `toDomainTodayBoard` |
| Movement storage advisor | `recommendMovementStorage` |
| Unit tests | `test/fbis-domain.test.js` (6/6) |
| Additive `/api/today` field | `domain` on today JSON (legacy board unchanged) |

## Contracts (summary)

- **Event** — identity, teams, model projection, consensus markets, movement summary, public splits, decision (qualified ≠ authorized), provenance
- **MarketQuote** — line/price/book/open/consensus/timestamps nullable; never invented
- **PlayerMarket** — providerPlayerId vs fbisPlayerId; nullable imageUrl; `decisionEligible` always false here
- **TodayBoard** — events + top opportunities from real QUALIFIED then WATCHLIST only (max 5)

## Explicit non-changes

- Odds router unchanged
- Action remains shadow / non-qualifying / non-authorizing
- Model coefficients unchanged
- No bankroll dollars
- No UI shell rebuild yet (Phase 3)

## Next

Phase 3 — AppShell + customer/admin navigation separation, sport-as-filter.
