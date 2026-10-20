# Tennis portrait release recovery — October 20, 2026

## Purpose
Re-trigger the already-reviewed and merged full-bleed portrait update and the
20-candidate Wikimedia Commons import after an unrelated NHL migration ledger
conflict prevented CI from reaching production deployment.

## Verified state
- The 0117 NHL goalie confirmation migration's four columns and index were
  present in production D1; `schema_migrations` recorded it at 07:58:32 UTC.
- Wrangler `d1_migrations` lacked the filename record. It was inserted only
  after verifying all original migration effects; no goalie data was changed.
- Main already contains PR #1322, including `object-fit: cover` profile images,
  a 48-entry Commons manifest and regression tests. Branch CI was green.
- The original main CI run was canceled by concurrent main commits before
  reaching the seed step.

## One-time release trigger
This metadata-only commit is tagged `[tennis-commons-seed]` so
`.github/workflows/ci.yml` validates and deploys the current exact SHA, then
invokes `scripts/seed-tennis-commons.mjs` only after successful deploy.

The seed verifies each Commons file, author, license, media signature, canonical
player ID and authorized R2/D1 importer response. It reuses existing approved
portraits without replacing them. Failed candidates remain unapproved.

## Validation
Confirm successful CI/deployment/release jobs, check
`TENNIS_COMMONS_SEED_SUMMARY`, query the production portrait registry and
inspect Rebecca Sramkova's permanent player profile crop.
Do not count candidate entries as successful imports.
