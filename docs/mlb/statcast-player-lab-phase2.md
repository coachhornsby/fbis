# FBIS MLB phase 2 — Statcast player-profile lab

## Scope and interface

Adds an interactive Statcast lab inside the existing MLB player profile. Existing roster portraits and shared prop-card headshot treatment are unchanged. The two user reference images inform the analytical layout, not the source values or metric definitions.

Implemented views:

- Catcher-view pitch-location heatmap from actual pitch-count bins, with each batter's strike-zone height normalized. No synthetic density surface or smoothing.
- Separate arsenal usage versus left- and right-handed batters (pitcher profiles), or pitchers (batter profiles).
- Velocity/spin, horizontal/vertical movement, release-point, and derived approach-angle plots. These display pitch-type means, not fabricated individual pitch clouds.
- Pitch and PA counts, K%, BB%, K-BB%, Zone%, Chase%, SwStr%, whiffs per swing, hard-hit%, barrels, and xwOBA on contact.
- Arm angle, release height/horizontal/extension and sample standard deviations of measured arm angle and release positions.
- Season trends for xwOBA on contact, Chase% and SwStr%, by fastball/breaking/offspeed group.
- Filter controls: season, competitive/regular/postseason scope, opponent handedness, pitch group/type, pitch result, PA result and in-/out-of-zone location.
- Exact arsenal table, metric sample sizes, source timestamps, measured coverage and expandable method definitions.

Official Run Value, SSW, count-leverage Zone%, league-average benchmarks and xRA/100 are **not** inferred from a player-only sample. The methodology panel distinguishes the supplied batting run-expectancy change from an official Run Value. No new confidence rating or wager permission is introduced.

## Architecture

`MLB roster official ID → scheduled Statcast collector → final-game identity verification → immutable compressed R2 source/snapshot → /api/mlb-statcast-lab → existing player profile`.

New modules:

- `functions/lib/mlbStatcastLab.js`: deterministic normalization, filters and analytical operands.
- `functions/lib/mlbStatcastLabStore.js`: compressed archival evidence, content hashes and readback validation.
- `functions/api/mlb-statcast-lab.js`: cached public descriptive reads; header-authenticated operator ingestion.
- `scripts/mlb-statcast-lab-collect.mjs`: bounded acquisition, retries, source timing, exact identities and receipts.
- `src/features/teamProfiles/MlbStatcastLab.jsx` and its stylesheet: responsive SVG charts and interactive filters.

No D1 migration, sport-ownership cutover, production-model input change, or market-price input is added. Large pitch observations stay in R2 under `models/mlb/player-lab/v1/<role>/<official ID>/<season>/<semantic hash>/`. Raw CSV and normalized JSON are compressed before storage. A small current pointer identifies the immutable source snapshot. Retries reuse a matching version; a correction creates a different content hash. Public reads never fetch Savant or fan out to upstream player sources.

## Calculation definitions

- Every normalized record keeps official game/player IDs, PA and pitch numbers, competitive game type, date, handedness, outcome and measured Statcast fields.
- Duplicate game/PA/pitch records are removed. Wrong player IDs, noncompetitive dates, future observations and game IDs outside the official final-game schedule are rejected.
- Automatic balls/strikes retain terminal-PA evidence but are excluded from actual-pitch counts and pitch-rate denominators.
- K% = terminal strikeouts / recorded terminal PAs; BB% includes ordinary and intentional walks in that recorded PA sample. Pitch/outcome filters change this sample. These are not silently substituted for full official season rates.
- Chase = swings outside the zone / pitches outside the zone with known zone classification.
- SwStr = swinging strikes / actual pitches. Whiff = swinging strikes / swings. These are separate metrics.
- Hard-hit = BBE with EV ≥95 mph / BBE with measured EV.
- Barrel = supplied launch-speed-angle category 6 / BBE with a supplied category 1–6.
- xwOBA on contact = sum of supplied expected-wOBA values on BBE / BBE with that value. Missing values are excluded, never filled with a league constant.
- Release and velocity/spin means use their own measured sample counts. Sample SD retains sum-squared deviations and the n−1 denominator.
- Movement plots convert `pfx_x`/`pfx_z` from feet to inches and explicitly label them as deviations. They are not relabeled as every break/IVB definition from another dashboard.
- Approach angles are derived from vx0/vy0/vz0 and ax/ay/az, solving for arrival at a fixed front-of-plate plane (17/12 feet from plate-back). The label distinguishes this calculation from a directly supplied official angle. Impossible/missing trajectories stay unavailable.
- 2026 ABS-era plate-coordinate convention is identified separately from pre-2026 source conventions.

Official source-field documentation: https://baseballsavant.mlb.com/csv-docs .

## Collection and coverage

The initial operations trigger runs a named-player proof for Tarik Skubal (669373, pitcher), Paul Skenes (694973, pitcher) and Aaron Judge (592450, batter), covering 2024–2026. It also starts 30 throttled current-roster team shards for the same seasons, with at most two jobs running at once. Daily refreshes collect the current season for all 30 current rosters. Manual dispatch supports exact player IDs or all team shards.

Each team job is limited to 60 players and at most three seasons. Each source response is capped at 18 MB / 14,000 rows. Request retries are bounded; each player-season produces an explicit success/error receipt. The collector waits for the new API version before ingestion. A failed or unavailable season is not presented as complete. A current-roster history refresh is not the complete 2024–2026 corpus of every retired, released, minor-league or former MLB player.

Local official-source proof before release: Skubal 2024 CSV returned 3,136 records, including six automatic-ball events. The normalized sample includes regular season, Wild Card and Division Series data. Independent schedule reconciliation rejected zero records for identity, date/game scope or final-game membership. Actual pitch totals exclude those six automatic events; terminal intentional-walk evidence remains.

## Validation and release gates

Focused tests cover wrong identities, final-game membership, competitive scopes, zeros versus missing values, duplicate pitches, PA filters across all pitches in a PA, handedness denominators, distinct SwStr/whiff/chase denominators, expected-contact coverage, heatmap orientation, derived-angle equations, immutable archive reuse, integrity failures and authenticated writes. Build and full FBIS regression checks are required before merge.

Production acceptance requires:

1. Passing PR CI and approved production deployment.
2. Named-player source ingestion receipts and counts for each player-season.
3. Live browser verification of the charts and filters against the persisted API response.
4. Explicit distinction between verified pilot coverage and the larger roster-shard collection that can still be running.

Full historical feature replay, challenger evaluation, model promotion, global league baselines and the remaining full game-history backfill from phase 1 are separate gates, not implied by rendering these charts.

## Initial production evidence and completed-PA correction

Implementation PR #1650 merged as `46be721dbec50788a477a373e5157fe47286147a` after CI `40062333975` passed. Cloudflare deployment `947c6a33-bf9d-47c7-8d2d-f08666fbbdcc` served that SHA. The named-player proof job in workflow `40062456887` passed all nine player-season imports with no errors. Source pitch counts: Skubal 3,130 / 3,152 / 2,531; Skenes 2,125 / 2,997 / 2,890; Judge 3,158 / 2,736 / 1,217 for 2024 / 2025 / 2026 respectively. These exclude automatic events.

Live browser inspection confirmed the lab, measured charts, all eight filters and season trends render without console errors. Skenes's 2025 regular-season source reproduces the user reference's 2,997 pitches, 733 PAs, 469 BBE, 29.5% K, 5.7% BB, 23.7% K-BB, 30.5% Chase and 27.8% whiffs per swing.

The 2026 source additionally contains two `truncated_pa` records. Calculation version `mlb-lab-metrics-v1.1` restricts PA-based rate denominators to explicit completed batting outcomes, excluding truncated PAs and baserunner-only events. These pitch observations remain in location/arsenal analyses. The frontend query carries this calculation version so old cached rate responses cannot mask the correction. Existing normalized source archives remain valid and do not require re-ingestion.

The 30-team current-roster historical refresh is a resumable background workflow, separate from the verified nine-player-season proof. Its completion must be judged from all shard receipts, not inferred from the pilot.
