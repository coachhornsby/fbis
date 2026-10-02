# CFB full-history v3 research architecture

## Objective
Create the broadest reproducible, point-in-time-safe CFB research corpus FBIS can assemble from free/public and already-authorized sources, while preserving market data strictly as an evaluation benchmark.

## Historical layers

### Game/event layer — SportsDataverse / cfbfastR
Primary compact history begins in 2004. The upstream release catalog includes raw ESPN play-by-play plus derived game/team/player tables. FBIS stores the compact derived training matrix and treats raw PBP as an auditable source rather than duplicating the multi-gigabyte corpus.

Consumed derived families:
- schedules/results
- resolved betting benchmark
- team advanced offense
- passing / primary QB
- rushing
- receiving
- defense
- turnovers
- drives
- situational football
- specialists / special teams
- team box
- power index

Every rolling game-derived feature is shifted one game before it becomes a pregame feature.

### Program-strength layer
- weekly adjusted ratings: 2004-current
- weekly FPI: 2005-current
- team talent: 2005-current
- returning production: 2005-current
- recruit-level history: 2002-current
- recruiting projections: 2016-2025 in current public release

Weekly ratings/FPI are joined only from a snapshot strictly before the target game week. FPI rows marked non-contemporaneous or out-of-sequence are rejected.

### Market layer
Two independent free/authorized line histories are retained:
1. SportsDataverse / ESPN resolved betting line, 2004-current where available.
2. CFBD provider-level line history, 2013-current where available, preserving every sportsbook/provider row.

Provider-level CFBD source names observed in the historical extraction include Bovada, Caesars variants, DraftKings, ESPN Bet, SugarHouse, William Hill, consensus, numberfire and teamrankings.

Canonical benchmark uses the resolved SportsDataverse/ESPN line when present and CFBD provider-median consensus only as a fill. All raw provider rows remain separately available.

Market lines, opening lines, totals and moneylines are prohibited from the independent model feature set.

## Known market gap
The combined free line sources cover approximately 95.5% of the 2004-2026 game history. The largest remaining historical gap is the 2012 season. A public GitHub sportsbook-review archive was inspected; its committed CFB odds files start in 2014, so it does not close the 2012 gap. Paid/proprietary sources are not silently introduced.

## Model validation
CFB-FBIS-v3-research uses:
- expanding chronological seasons
- train-only feature screening
- train-only collinearity pruning
- nested chronological Ridge tuning
- separate margin and total estimators
- closing market as benchmark only
- frozen prospective research fit trained through 2025

Research results do not alter qualification, wager authorization, or frozen historical production projections.
