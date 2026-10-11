# CFB directory and ranking release evidence

Production baseline: main f73ef60d3baa972f76a58e5d51cfc7eab7c0f8bc, Pages 13f499e2-3713-4119-b1a6-cc09f3cc27ac. The attached read-only acceptance report verifies 138 canonical FBS teams and 70 public schedule cards across two weeks against 14 complete source days. No duplicated or non-FBS matchups were found. The baseline audit's projectionShapeRecognized field used a wrong field path; it is not evidence that forecasts were missing. The accompanying script now checks projHomeScore/projAwayScore and separately reports provisional and qualification-blocked forecasts.

This release connects cached SDV statistics to team profiles, displays all supplied metric fields, adds 21 explicit team/conference categories, corrects defensive conference weighting, and adds final FBS interconference records. Missing special teams, personnel, schedule-strength and calibrated ranking uncertainty remain explicitly unavailable. Display rankings have no projection or wagering authority. Historical season views do not present current summaries as historical evidence.

Local validation: production build passed; full npm test passed 1,490 tests; focused ranking/fixture tests passed after audit field correction; git diff --check passed. Existing build warnings concern duplicated unrelated college properties, CSS escapes and bundle size.

## Production gates

Production remains at migration 0097. The five 0098 persistence tables and four 0099 statistical tables are absent. Pregame feature and player-role snapshots have zero rows. The full remote independent recovery and Gemini Spark verification remain blockers. This release adds no database migrations, coefficient changes, paid source activation, wagering authority, or champion promotion.

Of 138 summary teams, 117 have summary-game gaps versus final results at the recorded observation. This release exposes that lag; it does not claim automatic postgame reconciliation is complete. Source publication times unavailable from the provider remain null.

## Exact acceptance and rollback

After deployment, run scripts/cfb-production-acceptance.mjs with the current America/Chicago date. Require 138 unique FBS identities, both weekly windows matching source IDs/orientation/kickoff, all seven source days per window, no duplicate/non-FBS cards, and 21 ranking categories. Verify team profiles show current source hash, metric sample counts, summary lag and explicit missing-data states; historical season selection must hide current-season summaries. Independently review the same deployed SHA with Gemini Spark before declaring the release verified.

Rollback: revert this release commit and deploy the resulting Pages artifact. No database rollback is needed because this release does not mutate schema or records. Retain the acceptance JSON and CI artifacts; do not erase historical source evidence.
