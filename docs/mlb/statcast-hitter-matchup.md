# Hitter profiles and archived matchup candidate

Hitter profiles now show contact/swing, K/BB, chase, whiff, exit velocity, launch angle, hard hits, barrels, xBA on contact, xSLG on contact, and xwOBA on contact. Contact-quality and discipline plots replace pitcher release/trajectory plots. Handedness donuts describe pitches faced. Pitchers retain their existing charts. Existing headshots are unchanged.

Expected contact averages use measured batted balls only. They are not full-PA xBA/xSLG. Each metric exposes its measured denominator. Official fields: https://baseballsavant.mlb.com/csv-docs.

## Candidate endpoint

GET `/api/mlb-statcast-matchup?pitcherId=669373&batterId=592450&pitcherHand=L&batterHand=R&asOf=2026-10-24`

The adapter loads existing R2 archives in parallel, with no source acquisition or D1 writes. Exact identity and role are required. Each side uses the opposing hand, a trailing 365-day window, and only game dates strictly before asOf. Unknown hands are not reassigned. Pitch keys are deduplicated. Automatic events are omitted from pitch observations but completed automatic walks remain in PA denominators. Truncated and baserunner-only PA events are excluded.

At least 200 actual pitches and 50 completed PAs per side are required. Otherwise candidate is null with sample reasons. A qualifying pair uses the existing mlbPitchMatchup research coefficients and exposes K rate, contact/whiff, expected contact damage and run factor with sample/source hashes. These are candidate features, not production prop projections. The UI does not label them FBIS fair prices.

## Evaluation and limits

Tests cover exact identities, opposing hands, duplicate removal, future/date boundary exclusion, missing archives, invalid dates, measured zeroes and separate contact denominators. Build/full repository tests are required before release.

Retrospectively acquired archives do not prove features were available before historical games. This adapter is not a leakage-free historical validation record. No candidate is promoted, no champion changes, and wager authority remains false. Fixed reference rates and existing heuristic coefficients remain uncalibrated. Opportunity (lineup/PA), bullpen, park, HR and total-base outcome heads, and held-out comparison against the champion remain separate work requiring game outcomes and point-in-time feature snapshots.
