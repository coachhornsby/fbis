# WNBA FBIS player-impact architecture

## Models

- Incumbent game model: `WNBA-FBIS-v2`
- Incumbent player model: `WNBA-PLAYER-PROJ-v2`
- Player-impact research model: `WNBA-FBIS-PLAYER-IMPACT-v1`
- Game impact challenger: `WNBA-FBIS-IMPACT-v1`
- Prop impact challenger: `WNBA-PLAYER-PROP-IMPACT-v1`

The incumbents retain wager authority. Impact challengers are shadow-only until prospective promotion gates pass.

## Metric philosophy

EPM is the primary modern benchmark/design reference. The production implementation is FBIS-native and does not require proprietary published EPM values.

The impact stack uses:

- EPM-style statistical prior + adjusted plus/minus posterior;
- DARKO-style dynamic/recency skill updating;
- regularized RAPM from lineup stints;
- raw on/off and lineup context;
- BPM/VORP-style box diagnostics;
- WS/48-style historical diagnostic;
- regularized five-player, trio and pair lineup effects;
- point-in-time role/minutes/usage redistribution.

External EPM/DARKO/LEBRON or similar values may be used only as research benchmarks when rights permit. They are never mandatory production inputs.

## Temporal integrity

Every impact, role and wager feature must be reproducible as of its feature cutoff.

Forbidden:

- current-game results in the pregame feature set;
- retrospective injury knowledge;
- closing lines in pre-close decisions;
- postgame lineup knowledge;
- season-end aggregates applied backward;
- market lines as independent projection features.

Availability changes may alter role redistribution only when an immutable approved availability observation existed before the projection timestamp.

## Historical evidence

The frozen 2024-2025 research build contains:

- 576 WNBA games;
- 10,371 reconstructed lineup stints;
- 218 player-impact profiles;
- 39,852 chronological walk-forward player-market observations;
- 9,963 observations in each core market.

A direct player self-impact multiplier did not improve MAE in points, rebounds, assists or made threes. It is rejected.

Therefore player impact is not permitted to mechanically inflate or deflate a player's own stat projection merely because her impact rating is high or low.

## Prospective challenger use

The impact layer may affect:

- expected rotation;
- minutes redistribution;
- usage redistribution;
- assist opportunities;
- rebound opportunities;
- three-point opportunities;
- lineup-context efficiency;
- availability-driven team scoring adjustment.

These effects remain prospective shadow features.

## Promotion gates

Prop challenger promotion requires:

- at least 200 graded observations in every core market;
- at least 75 point-in-time PrizePicks line comparisons in every core market;
- at least three of four core markets improve MAE with non-negative side-accuracy change;
- no core market has material MAE regression greater than 0.04;
- no leakage finding.

Game impact promotion requires at least 100 prospectively graded games with improved margin MAE and non-worse total MAE.

Promotion into wagering also requires the normal FBIS price/EV, CLV, ROI, drawdown, stability and confidence-calibration evidence. Historical subgroup performance never directly generates a bet.

## Data operations

Historical research is frozen in immutable R2 storage and normal pushes never reacquire it.

Normal operation:

1. Increment only the latest completed WNBA date.
2. Append current-season player/game boxes.
3. Append current-season PBP/lineup stints.
4. Recompute combined historical + current lineup effects.
5. Read point-in-time approved availability observations.
6. Refresh player impact and role context.
7. Keep incumbent projection and impact challenger side by side.
8. Persist immutable challenger snapshots.
9. Grade against existing PrizePicks lines and completed outcomes.

The impact workflows make no additional paid ACTION or PrizePicks acquisition calls.
