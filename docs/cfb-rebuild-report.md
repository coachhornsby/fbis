# CFB Rebuild Report — Game + Player Architecture

Branch: `cursor/cfb-player-v1-312d`

## Status summary

Architecture for independent CFB game (CFB-FBIS-v2) and player (CFB-PLAYER-v1: QB1/RB1/WR1) is implemented as shadow research. **Neither model is promotion-eligible** until temporal OOS backfill with real CFBD history completes. Champion `FBIS-v1.4` / HFA 2.5 unchanged.

### Honest gaps (data decides)

| Item | Status |
|------|--------|
| Live CFBD audit normalized | Done (prior PR) |
| Canonical cadence layer + CORE throughWeek | Done |
| Regularized preseason prior | Done (weights provisional) |
| Game A–K ablations (code) | Done |
| Game OOS metrics 2022–2025 | **Blocked** — needs `CFBD_API_KEY` Actions secret + backfill |
| Player OOS / role-temporal backtest | **Blocked** — same |
| Champion comparison / promotion | **Not earned** |
| PrizePicks / NoVig live feeds | Interface-only (no CFB automated access in repo) |

## 1. CFBD endpoints used

See live audit + `docs/cfbd-feature-availability.md`. Primary independent paths:

- Prior: `/ratings/sp`, `/ratings/fpi`, `/ratings/srs`, `/ratings/elo`, `/talent`, `/player/returning`, `/recruiting/teams`, `/player/portal`, `/coaches`
- In-season: `/ratings/core` (throughWeek), `/ppa/games`, `/stats/game/advanced`, `/ppa/players/season`, `/player/usage`, `/stats/player/season`, `/roster`, `/games`
- Context: `/games/weather`, `/venues`
- Evaluation only: `/lines`

## 2–4. Historical reconstruction / temporal controls / feature set

- Prior-season freeze (class A) via `regularizePreseasonPrior`
- Rolling game PPA + advanced before kickoff (class C reconstruction)
- Week-bounded CORE preferred over undated SP for in-season
- `assertPregameTemporalIntegrity` + player `filterPlayerGamesBeforeKickoff`
- Class D/E excluded from independent score (`features.evaluation` for lines)

## 5. Features rejected for independent score

- Closing lines / pregame WP (class E)
- Undated same-season SP+/FPI aggregates for historical weeks (class D)
- End-of-season role leaders for historical player identity
- PrizePicks / NoVig / sportsbook props as model inputs

## 6–10. Prior / shrink / FCS / QB / uncertainty

- Prior: weighted SP 0.35, CORE 0.25, FPI 0.20, SRS 0.12, Elo 0.08 + personnel soft adj
- Shrink: `n/(n+6)` benchmark retained (`shrinkageWeight`)
- FCS: team SRS/Elo → conference mean → PROVISIONAL + wider σ
- QB game adj: residual vs team pass PPA; unknown/transfer widens σ
- Uncertainty: margin/total/home/away score σ; LOW/MEDIUM/HIGH

## 11–14. Ablations / OOS / champion / market

- Ablation masks A–K implemented; **fitted OOS numbers not yet available**
- Promotion criteria unchanged; challenger remains `provisional-unfitted`
- Market baseline (`CFB-PINNACLE-IMPLIED`) evaluation-only

## 15–24. Player system

- Identity: `cfbPlayerIdentity.js` — confirmed starter > recent usage; Week 1 widens; TE excluded from WR1
- Model: environment → opportunity share → efficiency → distribution
- Coherence: OTHER_RUSHING / OTHER_RECEIVING residual buckets
- Markets: see `docs/cfb-player-v1.md`
- Ablations QB A–G, RB A–F, WR A–F coded; OOS pending backfill

## 25–27. Prop market status

- PrizePicks: interface-only, no conventional EV without payout structure
- NoVig: interface-only for player props (team OCR tools exist elsewhere)
- Correlation tagging research-only; no auto entries

## 28–30. Prospective / cost / migrations

- Slate attaches CFB-PLAYER-v1 from game environment (no CFBD fanout on page load)
- `estimateRequestCount()` — customer fanout 0
- Migration `0019_cfb_player_projections` + schema.extensions sync
- Health expects `0019_cfb_player_projections`

## 31–33. Files / tests

Key new: `cfbdCanonical.js`, `cfbPlayerIdentity.js`, `cfbPlayerModel.js`, `cfbPlayerCoherence.js`, `cfbPropMarket.js`, `data/models/cfb-player-v1.js`, `test/cfb-player-v1.test.js`, `docs/cfb-player-v1.md`

Tests: full suite green (485+ after this change).

## 38–39. Governance verdicts

- **CFB-FBIS-v2 promotion eligibility: NO** (unfitted; OOS incomplete)
- **CFB-PLAYER-v1 research-readiness: NOT READY** (architecture + unit tests only; needs temporal player backfill)
