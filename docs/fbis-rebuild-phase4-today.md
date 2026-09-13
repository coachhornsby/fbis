# FBIS Rebuild — Phase 4 checkpoint (Today command center)

## Delivered

- Today leads with decision surfaces, not pipeline health:
  - Top game opportunities (QUALIFIED then WATCHLIST only, max 5)
  - Top player props (research-only until authority earned)
  - Market movers (real movement magnitude only)
  - Watchlist / near qualification with reason codes
  - Full slate retained below
- Operator diagnostics collapsed under “Pipeline / data health”
- Domain board helpers: `marketMovers`, `watchlist`, `topPlayerProps`, sport-scoped filtering
- Movement magnitude may be derived from real open→current lines only (never invented)

## Files

- `src/features/today/*` — command-center feature module
- `src/TodayView.jsx` — wires command center; ops collapsed
- `functions/lib/fbisDomain.js` — today board summaries
- `test/fbis-domain.test.js` — movers / watchlist / props / sport filter

## Safety preserved

- No fabricated top-5 when none qualify
- Action / player props remain non-decision-eligible
- No bankroll dollars / auto-execution / Action promotion

## Next

Phase 5 — Game workspace (model / market / best prices / movement / decision).
