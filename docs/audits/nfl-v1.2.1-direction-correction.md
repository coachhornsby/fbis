# NFL research v1.2.1 direction correction

This is a deterministic semantic correction, not a fitted or accuracy-validated model.
The production champion and wager permissions are unchanged. Historical forecasts
must retain their original versions and decompositions.

- Passing/rushing EPA allowed is opponent offensive EPA, so offense and opponent
  EPA allowed enter with positive signs. Lower allowed EPA lowers offense score.
- Explosive rate allowed and line yards allowed also enter with positive signs.
- Offensive pressure allowed and opponent pressure generated both enter negatively.
- Team-power defense EPA, success allowed and early-down allowed already enter
  negatively, correctly increasing team margin as its defense improves.
- V2 inherits these fixes; its extra run and pressure interactions are also corrected.
- V2 man/zone frequencies weight the offense's EPA against each coverage. These
  are exposure shares rather than ordered defensive-quality measures and do not
  have a universal increasing/decreasing score direction.

## Centering and missing references

Nonzero-baseline quantities use offense + opponent allowed - 2 * league reference.
Pressure uses 2 * league reference - offense allowed - opponent generated.
References come only from explicit game.nflLeagueBaselines fields explosiveRate,
pressureRate, and lineYards. They must be sourced from the corresponding pregame
feature definition/window by an upstream provider. No hardcoded empirical league
means have been fabricated. Existing verified snapshot preparation does not yet
supply these references, so these three contributions remain null and coverage
decreases until that contract is implemented. A league-average matchup is neutral
when explicit references are supplied. Test fixture values are not production priors.

## Verification and limits

The synthetic tests establish direction, score accounting, missing-data behavior,
and market independence only. They do not establish predictive accuracy.
The existing historical walk-forward command failed fetching nflverse NGS rushing
data with HTTP 504. No valid historical calibration result was obtained. Calibration,
frozen pregame replay, and leakage-safe walk-forward evaluation remain required
before promoting this revision as a wagering or production champion.
