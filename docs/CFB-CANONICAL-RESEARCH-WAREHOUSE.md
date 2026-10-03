# CFB Canonical Research Warehouse Contract

## Purpose
The frozen CFB snapshot is a research warehouse, not merely a model matrix. Preserve every obtainable source datapoint and its provenance so future models, ablations, feature engineering, and audits can run without reacquiring historical data.

## Layers
1. **Raw source layer** — lossless source tables by provider/season. Never overwrite published versions.
2. **Normalized entity layer** — games, teams, conferences, venues, coaches, players, rosters, recruiting, transfers.
3. **Event layer** — play-by-play, drives, team-game, player-game, scoring, possession and situational events.
4. **Context layer** — schedule, neutral site, rest, travel/venue, altitude, weather, conference membership, coaching continuity.
5. **Program/personnel layer** — talent, recruiting, returning production, portal, roster/depth/availability when timestamped.
6. **Ratings layer** — FPR/internal ratings plus external public ratings. External ratings are separately tagged and never silently treated as internally derived.
7. **Market-reference layer** — lines, odds, implied probabilities and market snapshots. Evaluation/execution only; prohibited from independent projection features.
8. **Derived PIT layer** — shifted rolling features, opponent adjustments, SOS, conference strength, pace, matchup interactions and other deterministic transforms.
9. **Model matrices** — intentionally selected feature views generated from the warehouse. These are disposable/rebuildable; the warehouse is canonical.

## Retention rule
Store all source columns, including text/categorical fields and fields not currently used by a model. Do not discard a field because it is nonnumeric, sparse, redundant, postgame, market-derived, or not presently useful. Classification controls eligibility; it does not control retention.

## Required provenance per table/field where available
- provider/source and endpoint/dataset
- source season/week/game ID
- retrieval/build timestamp
- observation/publication timestamp when available
- temporal class: PRE_GAME_SAFE, WEEK_FILTERED, RECONSTRUCT, PRIOR_ONLY, POSTGAME_ONLY, MARKET_EVAL_ONLY, UNKNOWN
- model eligibility: INDEPENDENT_ALLOWED, PRIOR_ONLY, EVALUATION_ONLY, PROHIBITED, UNKNOWN
- raw vs normalized vs derived
- transform/version lineage
- parent snapshot ID
- checksum

## Historical depth targets
Preserve the maximum source-supported history. Missing older seasons are explicit missing coverage, never synthetic values. PBP/advanced/event history should be retained from the earliest reliable source era; older schedule/result history may extend farther.

## Weekly active-season refresh
Published snapshots are immutable. Weekly refresh:
1. restore latest canonical snapshot;
2. acquire only new/changed current-season source partitions;
3. append/upsert by stable source keys;
4. recompute only causally affected current-season PIT/derived partitions;
5. run schema, uniqueness, temporal, provenance and checksum QA;
6. publish a new immutable snapshot with parent lineage;
7. retain prior snapshot.

## Research rule
Model workflows consume a pinned compatible snapshot and may create arbitrary model matrices from it. They may not trigger historical acquisition. Market data remains available for evaluation but is excluded from independent feature selection, tuning and fitting.


## Historical conference membership authority
Canonical team-season conference membership comes from the public SportsDataverse `cfb_groups` release:
- `cfb_team_group_seasons.parquet` — team, season, subdivision, conference, division, source, source-agreement and notes.
- `cfb_group_seasons.parquet` — season-specific conference names, abbreviations and parent groups.

FBIS joins ESPN-covered teams by `season + ESPN team_id`. Membership is never inferred from the current alignment and never backfilled backward. CFBD game-level conference fields may be used as an independent validation source when quota permits, but the canonical build MUST NOT depend on live CFBD calls for conference affiliation.

If an ESPN schedule team-season cannot be resolved from the public membership table, the build records the gap and fails the conference-coverage gate rather than guessing.
