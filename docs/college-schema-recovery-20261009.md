# College persistence recovery — operator execution STOP

Candidate restores exactly five original 0009 contracts: source_observations,
team_feature_snapshots, game_feature_snapshots, api_usage, team_season_identity.
It adds four original named indexes; primary-key indexes remain SQLite-owned.
These contracts have no foreign keys. No rows, historical migrations or model
authority tables change. Unknown extra constraints/indexes/triggers fail closed.

## Evidence and boundaries

Production D1 b50c724c-903b-4241-8ce1-48d931e7a44c has none of these five tables.
0009's schema_migrations clock matches 0086's bookkeeping clock (Oct6 15:21:01).
Wrangler recorded0009 on Sept8. This proves divergent ledgers/objects, not the
cause or time of disappearance. 0086 does not create these tables.

collegeStore.js reads/writes all five. collegeApi.js needs api_usage for quota
records; collegeJobsCore.js stores source observations/team features/identities;
cfbFeatureStore.js needs game_feature_snapshots as well as the separate existing
cfb_pregame_feature_vectors. Active current-refresh failures are a separate
provider/source question: their zero rows do not prove this schema gap caused
provider errors. Restoring empty destinations does not restore old evidence.

Additional absent model_registry/model_artifacts/model_predictions were found.
Those are NOT part of this repair because their recovery crosses model lifecycle
contracts. Existing model_validation_runs/model_promotion_decisions have later
definitions; this candidate does not replay the entire original0009.

Similarly named NBA/WNBA feature tables and cfb_pregame_feature_vectors contain
different contracts. They are not copied, renamed, deleted or substituted.

## Local proof

Node SQLite tests reproduce applied0009/0086 without objects, preserve sentinel
data and ledger clocks, compare original column/type/PK/default/FK/index contracts,
exercise five real writers, retain missing values and zero, and reject conflicting
AUTOINCREMENT/CHECK/UNIQUE/trigger schemas before0098 registration.
Wrangler local D1 is a separate required engine gate. A first monolithic guard
hit D1's expression-depth limit; bounded per-table guards replace it. A failed
batch must leave no marker. Local proof is not production recovery evidence.

## Preflight — read-only, from the reviewed candidate checkout

Verify reviewed SHA, project fbis and exact production database UUID in wrangler.toml.
Verify main/Pages identities and pending migration list. STOP if any unreviewed
migration would accompany release. Do not use broad migration replay.

```sh
node scripts/college-schema-preflight.mjs --sql > college-preflight.sql
npx wrangler d1 execute fbis --remote --file=college-preflight.sql --json > college-before.json
node scripts/college-schema-preflight.mjs --input college-before.json
npx wrangler d1 migrations list fbis --remote
npx wrangler d1 time-travel info fbis --json > before-bookmark.json
npx wrangler d1 export fbis --remote --no-data --output=before-schema.sql
```

Expected preflight: ok:true, missing:five expected names, conflicts:[]; all per-query
probes must be present. Missing/failed/truncated captures reject authorization.
If any required table now exists, export its data and compare contract/count/hash
before proceeding. Protect backup/bookmark evidence. Verify account retention
and restore permissions, not an assumed plan-specific recovery window.

## Exact authorized write — not executed by this sprint

Obtain separate approval for this file's exact SHA256, target UUID and execution
window. Coordinate in-flight college writers; do not silently alter schedules
or provider policies. Execute only the reviewed recovery file:

```sh
npx wrangler d1 execute fbis --remote --file=migrations/0098_college_persistence_recovery.sql --json > recovery-result.json
```

No historical0009 replay; no whole schema import. D1's atomic file/batch behavior
must match local proof; stop on any error and re-inventory rather than guessing
how far execution reached. Per-table guards run before schema_migrations0098.
The normal later release may idempotently apply0098 and register d1_migrations;
verify that only this reviewed migration is pending first.

## Postflight and natural-job acceptance

```sh
npx wrangler d1 execute fbis --remote --file=college-preflight.sql --json > college-after.json
node scripts/college-schema-preflight.mjs --input college-after.json --post
npx wrangler d1 execute fbis --remote --command="SELECT id,applied_at FROM schema_migrations WHERE id IN ('0009_college_research','0086_migration_lineage_reconciliation','0098_college_persistence_recovery');" --json
```

Expected postflight: ok:true, missing:[], conflicts:[]; prior markers unchanged.
Compare protected existing-data counts/hashes. Validate subsequent naturally
scheduled college jobs: original source clocks, accepted/persisted counts, feature
missingness, immutable cutoff and authority remain valid. Empty recovered tables
or a green health endpoint do not satisfy source or projection readiness.

Only deploy code expecting0098 after actual schema postflight. Until then merging
this branch into automatic release would expose a new required migration tip.
Merge and deployment require separate authorization.

## Failure and rollback

Before successful execution, stop and inventory; do not force a marker or edit
historical ledgers. Repeat is allowed only after compatible-contract preflight.
After success, prefer code rollback while retaining additive tables and any newly
written evidence. Do NOT drop tables or delete new records to roll back code.
Whole-database Time Travel restore rolls back unrelated live activity and requires
separate incident-level approval plus a plan to preserve intervening writes.

Official command references: https://developers.cloudflare.com/d1/wrangler-commands/
and https://developers.cloudflare.com/d1/reference/time-travel/.
