# CFB-PLAYER-v1 + CFB-FBIS-v2 rebuild

Shadow research architecture for independent CFB game projections and QB1/RB1/WR1 player props.

## Governance

- Champion remains `FBIS-v1.4` (HFA 2.5).
- `CFB-FBIS-v2` and `CFB-PLAYER-v1` are `canQualify: false` / no wager authorization.
- No automatic promotion. Model Lab criteria unchanged (`minOosN: 400`, `minSeasons: 3`, …).
- Market / PrizePicks / NoVig never enter independent scores.

## Data flow

```
CFBD (canonical cadence bundles)
  → seasonal / weekly / game-day caches
  → temporal feature store (A–E enforced)
  → CFB-FBIS-v2 game model
  → CFB-PLAYER-v1 (QB1/RB1/WR1 only)
  → prop market comparison (import/manual)
  → decision layer (future; research-only now)
```

## Endpoints used (from live audit)

Seasonal: `/ratings/sp|fpi|srs|elo`, `/talent`, `/player/returning`, `/recruiting/teams`, `/player/portal`, `/coaches`, `/venues`, `/roster`

Weekly: `/ratings/core` (throughWeek), `/ppa/teams`, `/ppa/games`, `/stats/game/advanced`, `/stats/season/advanced`, `/ppa/players/season`, `/player/usage`, `/stats/player/season`, `/games`

Game-day: `/games/weather`, `/scoreboard`, `/lines` (evaluation only)

## Player markets (this phase)

QB1: pass attempts, completions, passing yards, carries, rushing yards  
RB1: carries, rushing yards  
WR1: receptions, receiving yards  

Excluded: TDs, longest play, WR2/RB2/TE, miscellaneous scorers.

## Temporal rules

- Prior = prior-season freeze (class A) with regularized correlated ratings.
- In-season = week-bounded CORE + rolling game PPA/advanced (B/C).
- Role identity for historical games uses only pre-kickoff player-game rows.
- Class D/E never enter independent historical projections.

## Prop feeds

PrizePicks / NoVig / sportsbook props: **interface-only** until automated CFB access exists. Manual import supported. Correlation tags exist; no auto entries.

## Migrations

`0019_cfb_player_projections` — role snapshots, player projections, prop lines, comparisons.

## Request budget (estimate)

Customer page CFBD fanout: **0** (reads cached slate/challengers).  
Historical 4-season backfill: see `estimateRequestCount()` in `cfbdCanonical.js`.
