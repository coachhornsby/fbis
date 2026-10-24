# MLB player intelligence implementation — October 23, 2026

## Status

Partial implementation, not full production qualification. This report separates implemented code, observed production coverage, and work that has not been completed. No enhanced model is promoted and no wager permissions change.

## Architecture and ownership

Production Pages project `fbis` was inspected through Cloudflare. Its canonical deployment before this change was `13296261-d304-42e0-b55f-fc1f906d56da`, commit `c96e4a00598589a13cc9360a3f18a83c2ffc682e`.

`SPORT_DB_MODE_MLB=shadow`: primary `DB` (`fbis`, b50c724c-903b-4241-8ce1-48d931e7a44c) owns product MLB I/O. `MLB_DB` (b188629e-cdf7-49e6-b693-dead80777377) is not promoted by this change. Primary physical size observed: 8,511,766,528 bytes; MLB shadow: 661,291,008 bytes. No ownership cutover, table deletion, or historical data reclamation is performed.

Existing implementations reused: canonical team registry and official-ID mapping, persistent MLB player/team/Statcast profiles, production prop model, exact event/player/stat/period exchange joins, Kalshi archive, topology resolver, and shared `FBISPlayerPropCard`.

Data flow:

- Team registry → official MLB 40-man roster → canonical `mlb:mlb:<official player ID>` → player statistics view.
- MLB player game logs + official schedule → final, distinct, recorded appearances → scope-specific Last 5.
- Final live game feed → hashed raw and normalized compressed R2 objects → compact D1 game-version/player-record/membership-observation indexes and ingestion receipt.
- Existing independent MLB model → existing exact exchange join → shared card; this change preserves exchange evidence previously lost by Top 3's field projection.

R2 keys: `models/mlb/intelligence/games/<game ID>/<content hash>/raw.json.gz` and `normalized.json.gz`. Pitch observations retain game, inning, plate-appearance index, pitch number, batter, pitcher, handedness, pitch data, and available batted-ball data. R2 uploads precede D1 references. Detailed pitches are not copied into primary D1.

Migration `0124_mlb_player_intelligence` adds four tables: `mlb_intelligence_game_versions`, `mlb_player_game_records`, `mlb_roster_membership_observations`, and `mlb_intelligence_ingestion_receipts`. These preserve source versions. Membership observations establish presence for an actual game; they do **not** invent full tenure intervals or transaction dates.

## Data coverage observed before changes

| Production entity | Rows |
|---|---:|
| Team profiles | 30 |
| Player state profiles | 1,362 |
| Hitter profiles with nonempty Statcast JSON | 481 |
| Pitcher profiles with nonempty Statcast JSON | 516 |

Latest profile timestamp: `2026-10-23T21:41:50.046Z`. Nonempty JSON counts are not a metric-level completeness certification.

Local source proof: 2025 Wild Card game `813071`, official date `2025-10-01`, 33 distinct players, 52 batting/pitching/fielding records, 317 pitches, no missing batter/pitcher pitch identities. Repeating the generated SQL in SQLite left 52 records. The dry run did not persist these records in production.

Live official player-history proof: player `592450`, hits, cutoff `2025-10-04T12:00:00Z`: games `813065` (October 2, zero hits), `813070` (October 1, two hits), `813074` (September 30, two hits); all Wild Card type `F`. The primary Last 5 contains three postseason appearances; the separate competitive-recent view may include regular-season games.

No claim of 2024–2026 complete historical coverage is made. No per-season completion reconciliation exists yet.

## History and frontend

MLB is added to the existing team directory, not a second application. All 30 registry entries have official MLB team IDs. Roster cards/table open an exact-ID player view with official biographical data, season statistics, and round-labeled recent appearances. Existing headshot treatment is retained.

History explicitly requests regular season, Wild Card, Division Series, Championship Series, and World Series. All requests plus schedule verification must succeed. Spring training is excluded. Final schedule status, game identity, player identity, game-team identity, recorded appearance, and non-null stat value are required. True zeros remain. Doubleheaders retain distinct game IDs. Same-day historical finals require a completion timestamp; otherwise they are omitted conservatively.

Postseason scope does not fill missing playoff appearances with September. A separate labeled `blendedRecent` payload preserves competitive recent form. Legacy MLB detail requests without canonical player IDs are rejected instead of choosing the first name-search result. Canonical pitcher innings use integer outs (`5.2` = 17 outs).

Top 3 already reused `FBISPlayerPropCard`. This change preserves the joined provider/contract/identity/quote fields and adds official MLB identities to projection rows. Unvalidated MLB projection/sigma pairs cannot acquire a ranked hit probability from the generic normal-distribution helper. Player deduplication and game-local selection remain in the existing selector.

## Analytics and model testing

The box-score feature helper computes operand-preserving AVG, OBP, SLG, ISO, BABIP, hitter K/BB rates, ERA, WHIP, pitcher K/BB rates and K9/BB9. Missing operands remain missing. Source-observation and result-date cutoffs prevent use of evidence first observed after the replay cutoff; latest eligible corrections are deduplicated. This helper is not yet a daily feature-snapshot pipeline or a promoted production model input.

Existing MLB player models, pitcher workloads, matchup features, Statcast profile ingestion and model gates remain in place. No challenger comparison, accuracy improvement, calibration improvement, economic profitability, or model promotion is claimed. New pitcher FIP/xFIP, expected Statcast outcomes, full situational/rolling features, and daily versioned analytical snapshots remain unfinished.

## Collection workflow

`mlb-player-intelligence.yml` supports daily previous-day acquisition and manual bounded corrections/backfill batches, at most seven days and 40 games per invocation. The collector records remaining game IDs and errors and writes per-game idempotent receipts. It archives immutable source versions before compact indexes, rejects non-final feeds, and stops if deployed MLB ownership differs from the currently certified shadow/primary configuration.

The production importer verifies the deployed primary binding and physical D1 size before writes, reserving 2 MB per admitted game plus 200 MB headroom below a 9 GB stop threshold. Raw game responses above 25 MB are rejected.

This is a bounded import mechanism, not an automatically reconciled three-season backfill. Remaining games require subsequent batches. Rate-limit-specific backoff, persistent season checkpoint orchestration, complete final-game reconciliation, and long-run capacity qualification remain to be implemented before a bulk three-season run.

## Exchange integration

Kalshi and Polymarket remain intended providers. PrizePicks is not reintroduced. Existing exact canonical event/player/stat/period joins are reused. Preserving all joined fields fixes Top 3 evidence loss. No new authentic MLB Polymarket contract corpus or full deployed projection-to-contract coverage receipt is claimed. Missing contracts are not manufactured. Existing executable-quote and wager authorization controls remain.

## Validation

- Full `npm test` passed after updating migration-tip assertions for 0124.
- Targeted history/directory/Top 3/migration tests passed.
- `npm run build` passed with existing unrelated duplicate-key/CSS/chunk-size warnings.
- Migration verification passed: 139 migrations, 302 canonical tables.
- Cloudflare static configuration verification passed.
- Real source game import and repeat-import SQLite checks passed as described above.
- Broad MLB glob: 109/111 passed; the two failures in `mlb-market-validation.test.js` also fail on untouched baseline `c96e4a00` (`AWAY` versus expected team abbreviation). They are not introduced by this patch. The default CI test list does not include this file.

Browser, remote CI, migration, deployment, and production import receipts must be checked separately; local tests and dry runs do not establish them.

## Remaining acceptance work

1. Complete normalized player bio/alias/crosswalk storage and transaction-derived membership intervals across all organizations; historical game-team evidence is implemented.
2. Run and reconcile 2024, 2025, and available 2026 final games with persistent season checkpoints, capacity admission controls, and completion receipts.
3. Extend permitted Statcast collection to complete pitch metrics and situational windows; derive daily immutable feature snapshots with correction lineage and coverage.
4. Feed validated features into the existing model as a challenger; run historical walk-forward evaluation with leakage controls before any promotion.
5. Verify authentic deployed MLB Kalshi/Polymarket contract joins and historical threshold availability, and report exact matches and rejection cohorts.
6. Complete rich profile trends, pitch arsenals, situational charts, projections, and full game-log pagination from the persisted intelligence store. Current profile view provides official bio, season stats and recent appearances.
7. Qualify database-backed recent-history reads only after their coverage is reconciled; current product history still uses cached official upstream sources.
8. Verify remote release and production behavior; do not call this entire assignment complete until these gates pass.

## Release evidence

- Implementation PR: https://github.com/coachhornsby/fbis/pull/1638 (merged).
- Final PR head: `a3ba244e43f043f21315d1ed6f09f0295a1fd7f7`; CI run `40058446743` passed.
- Merge commit: `bb4ed1ee13b7b78b493e48c99b0ed2966b6e0752`.
- Primary migration registration verified: `0124_mlb_player_intelligence`, applied `2026-10-24 03:28:43` UTC.
- Shadow migration attempt failed atomically because that database has no `schema_migrations` table. Readback found none of the four new tables there. The shadow database remains unchanged and is not authoritative.
- The operations trigger `ops/triggers/mlb-intelligence-proof` requests one archived official game (`813071`), not a season backfill. Confirm its workflow receipt before claiming production import success.
