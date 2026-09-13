# FBIS Rebuild — Phase 5 checkpoint (Game Workspace)

## Delivered

- Domain-driven **Game Workspace** for expanded game details:
  - Model
  - Market
  - Best prices
  - Movement
  - Public splits
  - Decision (qualified ≠ authorized)
  - Player markets (research-only when present)
  - Venue / weather
  - Provenance / quality
- Wired through `GameDetails` for Today + board expand rows
- Deep CFB / legacy diagnostics retained under collapsed “lab” footer
- No invented prices, ranks, or wager authorization

## Files

- `src/features/game/GameWorkspace.jsx`
- `src/features/game/buildGameWorkspaceView.js`
- `src/features/game/game.css`
- `src/TodayView.jsx` (GameDetails → GameWorkspace)
- `test/game-workspace.test.js`

## Safety preserved

- Action remains shadow
- `decision.authorized` stays false
- Player markets default research-only
- No bankroll dollars introduced in workspace surfaces

## Next

Phase 6 — Player Props board / player workspace.
