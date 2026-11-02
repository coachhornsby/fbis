# CBB current-season inputs — November 2, 2026

FBIS only. Season 2027 means 2026–27. Seven-sport scope remains unchanged.

## Completed

- Current ESPN directory/rosters: 365 distinct teams and 5,543 players. All requested rosters returned the expected season and team ID. Availability remains UNKNOWN; roster membership does not establish health or active status.
- Added Queens, Southern Indiana and Lindenwood to the canonical CBB registry using verified ESPN IDs.
- Captured official Torvik `2027_team_results.csv`: 365 rows mapped to 365 distinct CBB IDs, zero unresolved. This capture does not certify the separate four-factor dataset.
- Fixed Miami basketball identities incorrectly resolving into football; fixed CBBD ending-year and query-parameter routing; blocked null model inputs from being interpreted as zero. Model coefficients and qualification gates were preserved.
- Loaded 365 compact rows into `CBB_DB.cbb_current_team_inputs`, keyed by `(season, team_id)`. The insert used 730 row writes plus three schema writes, adding approximately 1.5 MB. No historical records were removed.
- Read back all 365 records: 5,543 players, no source-hash, identity, JSON-validity or roster-length mismatches. The reader uses the dedicated CBB_DB binding and exact primary-key lookup, with no PRIMARY fallback or acquisition calls.
- Private Drive archive uploaded, independently downloaded, SHA-256 checked, all seven member files checked, and restored into isolated SQLite. All 365 restored payloads and hashes matched.

Archive: https://drive.google.com/file/d/1m3bPodgfT-ESQBstwKG4T8X6D0C5V8Jk/view

Archive SHA-256: `24189fbd54595e7f491c3f19daff6c354e4be3b1750e20a329bf7306301113fe`

## Still blocking finalized projections

CBB-PRO-v1 v1.1.0 has a frozen contract, but current KenPom and CBBD production captures are not verified. The attempted static build capture could not access runtime secrets and made no provider requests. Its temporary capture configuration and build hook were removed. Six earlier CBBD quota reservations remain conservatively counted; they are not evidence of completed downloads.

The current-input table is staged evidence, not approval for CBB cutover or prediction publication. The public board remains schedules/scores only. No current projections or bets were authorized. No collectors, Gemini tasks or ChatGPT tasks were restarted. The total model's wagering qualification remains disabled under its existing validation result.

Next operational dependency: execute bounded authenticated KenPom and CBBD captures in the secret-bearing runtime under the existing quota governor; archive and validate responses, then prove actual same-game projection generation and display before enabling predictions. Do not expose credentials to browser code or assume missing provider values are zero. A full-account $10 monthly ceiling still requires fixed charges, D1 storage, usage and tax to be accounted for; this phase does not certify that ceiling.
