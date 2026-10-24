# MLB Statcast + Ballpark Pal production integration

The existing canonical MLB score/F5/K path and player-prop engine now prefer verified archived Statcast pitch profiles, using the existing matchup coefficients. This is an input-path integration, not a newly trained probability model. Daily Pal park factors include weather; the environment resolver applies them once. Separate weather remains available when no Pal factor exists, or when an explicitly stadium-only Pal input is supplied. Null Pal factors stay missing and cannot silently become a neutral factor that suppresses weather.

## Data path and fallback

The slate loads immutable player-season archives via R2, validates official identity, row hashes and acquisition timing, and creates dated feature evidence before the scheduled first pitch. Current-season acquisitions older than 48 hours reject. Same-day results are excluded. A 90-day profile uses the existing 45-day decay, at least 200 actual pitches and 50 completed PAs. Automatic events never count as pitches; completed automatic walks remain in PA denominators. Truncated PAs do not count as completed PAs.

A lineup side requires all of its expected hitters (5–9 distinct IDs); a partially loaded lineup is not silently scored. A rejected side uses the existing persistent profile side. Two player reads run at once; compact profiles are memoized per player/role/game start. The customer path does not acquire upstream Statcast data. Exact source hashes and capture time travel with matchup evidence. Player-prop overlays retain official season rates and workload; only the Statcast profile changes. Existing authority and qualification gates remain in place.

This integration retains the existing pitch-family/location matching and coefficients. It does not fit a new handedness model, SSW, xRA or a new hit/HR probability head. Expected/confirmed lineup status retains the existing behavior. Pal finished probabilities and final projections are not new model inputs.

## Verification

Targeted tests cover environmental overlap, missing factors, temporal availability, sample thresholds, all-hitter completeness, source hash failures, PA counting and immutable state overlays. Full default tests, build and CI are release gates. Production verification must check the deployed SHA, live MLB response, evidence source selection and fallback behavior; successful deployment alone does not prove every lineup has sufficient archive coverage.
