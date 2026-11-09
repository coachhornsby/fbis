# Week 11 uploaded CFBD field-use audit

Source: user upload libfile_104a5be9d4b88191b03943be2eefd45b, SHA256 248068dc620cd1f2825746af1cc830b2d69a63bf1fbb0da74848dd73806055d3. 67 rows, 83 columns: 10 metadata, 72 numerical features, one market spread. No licensed row values are reproduced here.

## Actual live use

The upload reconciled 67 authoritative future fixtures. Its numerical feature values do not influence current CFB-FBIS-v2 scores. Those 65 forecasts consume actual completed-game raw per-game PPA and exact 2025 frozen priors, using the existing fitted A/A coefficients. Adjusted EPA in this upload has different semantics and cannot replace raw PPA. Two fixtures lack supported frozen priors; no replacement values were fabricated.

The parsed upload is immutable private research evidence in the task workspace and original Space attachment; this audit does not claim it was inserted into the production Tier 3 database or raw-source R2 storage. Fixture metadata and the source hash are in the model's immutable fixture manifest.

## Temporal and leakage limits

Parser receipt time is 2026-11-09T05:07:23.708Z, before every matched upcoming kickoff. This is ingestion time, not provider publication time or verified feature cutoff. The CSV contains no provider-published timestamp, as-of timestamp, documented source cutoff or training targets. The timezone-free kickoff literal is not authoritative. The strict parser preserves source_feature_cutoff_unverified and canInfluenceProjection=false.

The spread column is segregated from the 72 features. A regression test mutates all weekly numerical fields and spread while holding genuine PPA/prior inputs fixed; live frozen output and provenance must remain exactly unchanged. Genuine PPA perturbation is separately required to change model output. No future results or market lines are introduced into independent forecasts.

## Every field

| Field | Registry group | Current use |
|---|---|---|
| id | identity | Used to reconcile all 67 uploaded game IDs to authoritative ESPN fixtures; no numeric score effect. |
| start_date | identity | Stored literally. Timezone is unspecified; never used as the authoritative kickoff. ESPN supplies live kickoff. |
| season | identity | Validated as 2026; metadata only, no score feature. |
| season_type | identity | Validated as regular season; metadata only. |
| week | identity | Validated as week 11; never treated as proof of source feature cutoff. |
| neutral_site | identity | Checked for fixture consistency; live model uses verified ESPN neutral-site flag. |
| home_team | identity | Used for identity reconciliation; live model keys are authoritative ESPN IDs. |
| home_conference | identity | Identity context only, no score feature. |
| home_elo | team_strength | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_talent | team_strength | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_team | identity | Used for identity reconciliation; live model keys are authoritative ESPN IDs. |
| away_conference | identity | Identity context only, no score feature. |
| away_talent | team_strength | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_elo | team_strength | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| spread | market_reference | Market-only reference. Excluded from model features, fitting inputs and current executable quotes. Provider quote timestamp is unknown. |
| home_adjusted_epa | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_epa_allowed | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_epa | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_epa_allowed | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_rushing_epa | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_rushing_epa_allowed | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_rushing_epa | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_rushing_epa_allowed | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_passing_epa | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_passing_epa_allowed | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_passing_epa | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_passing_epa_allowed | opponent_adjusted_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_success | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_success_allowed | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_success | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_success_allowed | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_standard_down_success | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_standard_down_success_allowed | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_standard_down_success | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_standard_down_success_allowed | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_passing_down_success | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_passing_down_success_allowed | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_passing_down_success | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_passing_down_success_allowed | situational_success | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_line_yards | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_line_yards_allowed | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_line_yards | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_line_yards_allowed | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_second_level_yards | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_second_level_yards_allowed | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_second_level_yards | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_second_level_yards_allowed | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_open_field_yards | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_open_field_yards_allowed | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_open_field_yards | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_open_field_yards_allowed | rushing_performance | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_explosiveness | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_explosiveness_allowed | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_explosiveness | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_explosiveness_allowed | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_rush_explosiveness | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_rush_explosiveness_allowed | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_rush_explosiveness | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_rush_explosiveness_allowed | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_pass_explosiveness | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_adjusted_pass_explosiveness_allowed | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_pass_explosiveness | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_adjusted_pass_explosiveness_allowed | explosiveness | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_total_havoc_offense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_front_seven_havoc_offense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_db_havoc_offense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_total_havoc_offense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_front_seven_havoc_offense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_db_havoc_offense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_total_havoc_defense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_front_seven_havoc_defense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_db_havoc_defense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_total_havoc_defense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_front_seven_havoc_defense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_db_havoc_defense | havoc | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_points_per_opportunity_offense | scoring_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_points_per_opportunity_offense | scoring_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_points_per_opportunity_defense | scoring_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_points_per_opportunity_defense | scoring_efficiency | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_avg_start_offense | field_position | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| home_avg_start_defense | field_position | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_avg_start_offense | field_position | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |
| away_avg_start_defense | field_position | Parsed and retained for private research; not wired into the live frozen forecast. No validated weight or verified feature cutoff established for promotion. |

## Supported next step

Keep immutable uploads for prospective, point-in-time research and matchup context with explicit cutoff status. Correct known research-consumer defects and test directionality. Do not promote hand-weighted Elo/EPA proxies or a historically inferred through-week cutoff as validated live models. Numerical integration requires a compatible trained contract, leakage-safe chronological validation and verified cutoff evidence. The current feature registry and parser already preserve this separation.

## Audit corrections

Research-only passing/rushing matchup code had reversed EPA-allowed direction. Increasing an opponent's allowed EPA now correctly improves the attacking side's shadow margin, covered by monotonic tests. This does not modify the frozen primary model.

Weekly archive and holdout code previously inferred a verified cutoff from the week label and fabricated prekickoff collection times when missing or late. Those fallbacks are removed. Historical eligibility now requires explicit cutoff evidence plus an actual prekickoff source clock. Unknown or postgame evidence remains unverified instead of being rewritten.

Private frozen-model provenance now carries prior artifact hashes, prior endpoint receipt hashes and completion-evidence receipt hashes when available. Public summaries continue to omit private source payloads. The primary scores are unchanged by these auditability fields.

## Latest completed-game coverage, verified November 9

Read-only inspection of the actual stored PPA and completion packets captured at 12:08:47.985 UTC and 12:08:49.022 UTC found all 134 teams across the 67 fixtures had their latest completed regular-season game represented with numeric offense and defense PPA. No earlier completed games were missing among 1,209 team-game observations. The newest completed-game kickoff was November 8 at 03:30 UTC. No provider requests were made for this inspection.

A source being fifteen minutes old is not a problem when its completed-game coverage is intact. Source age, inclusion of the latest completed game, and historical prekickoff leakage are distinct checks. The new audit helper tests those distinctions and does not impose a fifteen-minute rule or change existing packet expiry. Coverage is verified against the captured completion schedule, not an assertion about unobserved later provider updates. It does not prove the weekly upload's feature cutoff.
