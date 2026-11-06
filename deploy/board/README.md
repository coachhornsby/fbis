# FBIS public board release — model summary restoration

Cloudflare Pages project `fbis` uses build root `deploy/board` and output `dist`.
The board remains a lightweight public schedule/score experience; browser score polling uses
credential-free ESPN scoreboard requests, without per-viewer D1, model execution, or paid providers.

## Anonymous FBIS model summaries

`/api/public/sports/{sport}/{date}` returns a strict projection-only summary for the
three explicitly allowlisted *FBIS-owned recovery models* (NFL team form, NBA-FBIS-v1,
CFB score-form research) when a precomputed, still-valid packet exists in private R2.
The endpoint strips private source payloads and all account/market/wager data. No sign-in,
secret, provider request, database query, job, or write is needed for a public page view.
Missing or expired packets remain unavailable; values do not silently fall back to
market odds or guessed scores. The existing private owner endpoints remain protected.

**CBB:** Current private KenPom-derived recovery forecasts are **not** exposed publicly.
The repository documents an unverified written-publication permission requirement and
incomplete native-total/current-CBBD gates. Public CBB schedules and scores remain visible
without a sign-in, but no numeric CBB forecast is shown until an independently eligible
and rights-cleared model packet exists.

The one-per-day bounded source producer is defined in
`.github/workflows/fbis-four-sport-recovery-once.yml`. The public model read route does
not activate that workflow or create recurring collection. Do not equate these research
form models with the frozen CFB-FBIS-v2 champion or with an authorized wager.

The one-shot release workflow `.github/workflows/fbis-public-model-card-deploy-once.yml`
runs safety tests and the existing static build, then deploys the Pages root once. It does
**not** enable automatic production deployments or switch any sport database to authority.

Preserve the user's Cloudflare budget controls and isolate model authority from public presentation.
