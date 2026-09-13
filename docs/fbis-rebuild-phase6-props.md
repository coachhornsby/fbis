# FBIS Rebuild — Phase 6 checkpoint (Player Props)

## Delivered

- **Player Props board** for the `player-props` route (replaces Phase 6 placeholder)
- Filters: FBIS-supported markets only (default), per-market chips, sport filter via shell
- **Player workspace** for selected player (research surface; model not authorized)
- Shared `normalizeBoardGame` adapter for `propConvictions` → `playerMarkets` (Today + Props)
- Empty states stay honest — no invented volume or eligibility

## QA

- `?boardQa=1` injects research-only sample player markets into Today / Player Props for layout verification (never decision-eligible).

## Supported markets

- `passing_yards`, `passing_attempts`, `completions`
- `rushing_yards`, `rushing_attempts`
- `receptions`, `receiving_yards`

Unsupported novelty markets remain countable but opt-in via “FBIS-supported markets only”.

## Files

- `src/features/playerProps/buildPlayerPropsBoard.js`
- `src/features/playerProps/PlayerPropsBoard.jsx`
- `src/features/playerProps/PlayerWorkspace.jsx`
- `src/features/playerProps/playerProps.css`
- `src/App.jsx` (route wiring)
- `src/features/today/TodayCommandCenter.jsx` (shared normalize)
- `test/player-props-board.test.js`

## Safety preserved

- Action props remain shadow / RESEARCH
- `decisionEligible` forced false via domain; board readiness is `RESEARCH_READY`
- `modelAuthorized: false` on board and rows
- No wager recommendation language beyond research status
- No bankroll dollars

## Next

Phase 7 — My Bets / Performance (strict population separation; units only).
