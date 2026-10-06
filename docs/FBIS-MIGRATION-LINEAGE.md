# FBIS Migration Lineage Ledger

Status: **immutable historical lineage**  
Purpose: document numeric migration-prefix collisions that predate the current uniqueness guard.

## Policy

- These entries are grandfathered history, not a naming convention.
- Do **not** rename or renumber any listed migration without an authoritative production-application ledger proving it was never applied.
- New migrations must use a unique numeric prefix. `npm run verify:migrations` fails on any collision not exactly listed in the verifier.
- File identity is the complete migration filename / migration ID; the numeric prefix alone is not a safe historical identifier.
- This ledger documents repository lineage only. It does not authorize schema mutation, model promotion, qualification, confidence, or wager authority changes.

## Grandfathered collisions

| Prefix | Immutable historical files | Reason retained |
|---|---|---|
| 0039 | `0039_nba_research_models.sql`; `0039_soccer_canonical.sql` | Historical collision already present before uniqueness enforcement; production application history is not proven safe to rewrite. |
| 0040 | `0040_cbb_player_prop_signals.sql`; `0040_nba_prospective_shadow_grading.sql`; `0040_wnba_prop_validation.sql` | Same. |
| 0041 | `0041_nba_market_qualification.sql`; `0041_nfl_wager_decisions.sql` | Same. |
| 0042 | `0042_nba_game_level_decision.sql`; `0042_nhl_wager_research.sql` | Same. |
| 0043 | `0043_nhl_wager_confidence_runs.sql`; `0043_wnba_wager_decision_architecture.sql` | Same. |
| 0052 | `0052_nba_deep_game_model.sql`; `0052_soccer_v2_features.sql`; `0052_tennis_full_markets.sql` | Same. |
| 0053 | `0053_nba_official_availability.sql`; `0053_tennis_player_bank.sql` | Same. |
| 0055 | `0055_mlb_persistent_profiles.sql`; `0055_nfl_persistent_team_profiles.sql` | Same. |
| 0067 | `0067_cfb_persistent_directory_phase_a.sql`; `0067_soccer_phase3b_validation_provenance.sql` | Same. |
| 0069 | `0069_nba_prospective_profile_ablation.sql`; `0069_nhl_goalie_shadow_integrity_v2.sql` | Same. |
| 0070 | `0070_fbis_cross_sport_evidence.sql`; `0070_nba_prospective_market_linkage.sql` | Same. |
| 0078 | `0078_asian_baseball_history_foundation.sql`; `0078_cfb_subdivision_normalization.sql` | Same. |
| 0079 | `0079_cbb_persistent_directory_phase_a.sql`; `0079_soccer_phase3f_research_routing.sql` | Same. |
| 0081 | `0081_soccer_phase3g_shadow_grading_fields.sql`; `0081_tennis_wta_official_zero_cleanup.sql` | Same. |

## Enforcement

The canonical enforcement list lives in `scripts/verify-migrations.mjs`. The verifier requires the observed owners for each grandfathered prefix to match that list exactly and rejects every new/unexpected duplicate prefix.

When adding a migration:

1. choose a currently unused numeric prefix;
2. register the migration ID in the migration itself;
3. update the canonical schema bundle for any new tables;
4. run `npm run verify:migrations`;
5. never add a new entry here merely to make CI green.
