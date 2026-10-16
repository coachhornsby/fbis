# FBIS FBS Team Profiles — read-only identity surface

## Scope
`/?route=teams` (optional `&team=cfb:espn:333`) is a **FBS-only** team profile page backed by existing `cfb_canonical_teams` D1 rows. It does not invoke ESPN, CFBD, SportsDataverse, Open-Meteo, sportsbook services or customer-slate refresh paths. API: `GET /api/cfb-teams` and `GET /api/cfb-teams?team=cfb:espn:<id>`.

At the audited 2026-10-10 D1 cutoff, 901 canonical college teams include **138 active FBS teams**. All 138 have stored coordinates, source colors and ESPN logo URLs. Do not substitute FCS/UNKNOWN/inactive teams to fill the list.

## Branding and geographic accuracy
The canonical `source_json` is a SportsDataverse ESPN-derived team dataset with CFBD enrichment. The profile presents source-reported `color`, `alternate_color`, ESPN CDN `team_logo`, nickname/`mascot`, venue name, capacity, surface, latitude/longitude, elevation and time zone.

**These are not independently confirmed university-official brand values.** The source's `mascot` is ordinarily the athletic nickname (e.g. Crimson Tide), not necessarily the name of the costumed mascot character (e.g. Big Al). Do not fabricate the missing character. The mapping is explicitly `officialVerified:false` until school-primary-source verification.

Venue latitude/longitude come from the stored provider observation. Preserve the original precision but do not assert the result is a surveyed field-center or exact street address. The map link uses source coordinates. For school-official accuracy a later **separately reviewed source-verification phase** should preserve the school/athletics/stadium URL, observation time, the verified property and reviewer. No unverified overriding of canonical IDs or studio logos.

## Statistical state
The page attempts a **read-only** lookup of the most recent `team_feature_snapshots` row. Production currently lacks this table, so the correct display state is `PERSISTENCE_UNAVAILABLE`; no zero-filled ratings, invented advanced statistics or reconstructed historical pregame features are shown. `team_form` is a separate stale legacy signal and is labelled accordingly, never presented as current model authority.

### Research CORE / advanced / prop panels
When snapshot fields from week-aware CORE + advanced plumbing are present (`core`, `ppaOff`, success rates, trenches, composite ratings), `/api/cfb-teams?team=…` includes a `researchPanels` object with bar-chart series, optional game sparklines from team-game evidence, and QB/RB/WR **shadow prop research input** cards. These are display-only (`canInfluenceProjection=false`, `canAuthorizeWager=false`). Full matchup `CFB-PLAYER-v1` projections still require a board game environment and remain unauthorized for wagers.

Existing draft PR #927 proposes recovery of missing college tables as migration 0098. This page intentionally does not merge, embed or apply it. Data recovery, persistent incremental game observations, point-in-time state versioning and projection reader routing are **separate release gates**. Even after migration, empty tables do not confer populated state.

## Boundaries
- Zero external provider acquisitions on Team Pages reads.
- Read-only D1 queries; no D1 mutations or migrations.
- Explicit FBS eligibility in SQL and mapper; 400 invalid ID and 404 for FCS/unmatched IDs.
- Research-only team state, `canInfluenceProjection=false`, `canQualify=false`, `canAuthorizeWager=false`.
- No fitted `CFB-FBIS-v2` mathematics, wagering authority or downstream Board change.
- Keep probability-integrity PR #936, player-prop PR #937, and persistence PR #927 independently reviewed.

## Independent release acceptance
Verify all 138 active FBS records appear in directory; FCS/UNKNOWN cannot be accessed by name or direct ID; mobile list, conference filter, team deep-link, responsive logo and colors work; no untrusted logo URL; stadium map pin corresponds to stored coordinates; mascot character is marked unsourced; source-verification warning visible; D1 missing table displays a useful unavailable state; non-Team routes and direct `?route=teams` do not trigger an accidental CFB paid-provider refresh.

Team Pages navigation and Board/Model model-authority state must be reviewed separately. No deployment without operator approval.


## Full team and individual statistics — new draft support

The FBS Team Page now supports season switching and all of the following research displays:
- complete source-observed per-team roster memberships across *all positions*, with canonical player ID, name, jersey, class, height, weight, position, observed-at provenance and filterable search
- team statistical feature groups: offense, defense, passing, rushing, tempo, situational, explosiveness, havoc, line-play, special teams, scoring, ratings and all additional named numeric fields from source-ledger JSON
- game-by-game team statistical breakdowns when an observed team-game ledger exists
- player-specific season statistics across passing, rushing, receiving, defense, special teams, kicking, punting, returning and advanced metric families
- individual player game-stat history and observed source timestamps
- source-grounded saved fixture/opponent log (NO invented final result, scores or player starts)
- explicit storage, temporal and completeness states (unavailable is not numerical zero)
- only a single FBS team can be requested by canonical ID; FCS teams remain excluded

On the last read-only production inspection: 25,969 2026 SDV/ESPN roster memberships span 234 teams, including 127 Alabama records. Existing `games` stores 1,059 2026 CFB fixture rows without verified final-score columns; `cfb_hfa_games` contains **zero** game observations. Team form has only 10 dated 2026 rows. The DB does not presently hold full player game-performance observations or the expected complete team/player statistics ledgers. Do not label roster membership as game participation or a box-score.

### Staged (not applied) new statistics storage
`docs/sql/cfb-fbs-team-player-statistics-candidate.sql` defines four immutable, timestamped ledgers:
- `cfb_team_game_stat_observations`
- `cfb_team_season_stat_snapshots`
- `cfb_player_game_stat_observations`
- `cfb_player_season_stat_snapshots`

Each preserves metric JSON, source, source timestamp when known, observed-at, content hash and no projection authority. The candidate is **not** in `migrations/` and has not been applied anywhere. First independently qualify and release PR #927's original missing college schema recovery (0098) with backups/preflight; then review and number this new schema against the actual production migration tip and its governance contract. No self-directed schema migration is authorized.

### Offline bulk historical-data staging
`scripts/cfb-team-player-stat-staging.py` accepts the original FBIS 2004–2026 `cfb_team_game_advanced` SDV/CFBD-enriched archive (ZIP or CSV). It produces JSONL of exact game/team source rows plus *explicitly partial* season totals for carefully selected additive metrics, with full metric coverage and manifest hashes.

Example with an existing local archive:

```sh
python3 scripts/cfb-team-player-stat-staging.py \
  --archive /path/to/cfb-full-history-v3.zip \
  --archive-observed-at 2026-10-02T14:11:00Z \
  --season 2026 \
  --output-prefix /tmp/cfb-team-staging
```

The supplied offline archive has 666 2026 team-game rows across 233 IDs, with game dates ending around October 2, 2026. Those figures do **not** establish current-week (October 10) freshness. Its package assembly time is not upstream first-observation time. For historical walk-forward evaluation, it is *postgame retrospective evidence, not a qualifying pregame frozen dataset*. No future games or unlinked IDs are accepted in staging.

Optional `--player-csv` requires a separate truly sourced per-game player statistics file with `game_id`, `season`, `game_date` (timezone-qualified), numeric `team_id` and `athlete_id` plus numeric performance columns. No such player-game source was included in the supplied historical archive, so the script cannot fabricate player performance. Player-data source/license qualification and the actual data acquisition/backfill must occur separately. Player rows are never assigned identities from names alone.

The script performs **zero database writes, API requests, provider acquisitions, conversions to live model features or production deployments**. Its outputs are review artifacts, not an automatically active source.

### Remaining acceptance gates for full live statistical population
1. Restore and verify original college feature/source state storage in #927 (already drafted, not approved).
2. Promote the candidate team/player statistical schema to a reviewed numbered migration *after* #927 is accepted. Verify source identity joins and all four tables.
3. Qualify legal, rate-limited, reliable current-season SDV/ESPN/CFBD team- and player-game feeds, including publication-time provenance. CFBD HTTP 429 and source freshness remain open.
4. Run validated, idempotent, immutable completed-game ingestion with no retrospective leakage. Publish aggregated season summaries only with explicit denominator/coverage.
5. Complete the 2026 backfill, check FBS team/player coverage per school/week, and validate source timestamps, revisions and identities before enabling filled stats.
6. Preserve a separate model-authority gate. Team pages cannot alter the current CFB fitted champion or player-prop wagering status.

**Thus the page architecture is complete for all metric categories and positions, but full live statistical coverage is not yet achieved.** Do not describe missing sourced data as present or the feature as production-live.
