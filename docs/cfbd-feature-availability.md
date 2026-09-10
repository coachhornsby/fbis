# CFBD feature availability (pre-live-audit)

Classifications show **unprobed** until `cfbd-endpoint-audit` runs with the production CFBD key.

| Feature | Endpoint | 2026? | Historical? | Pregame-safe? | Use |
|---|---|---|---|---|---|
| sp_plus_overall | /ratings/sp | unprobed | unprobed | ⚠️ | prior |
| sp_plus_offense | /ratings/sp | unprobed | unprobed | ⚠️ | prior |
| sp_plus_defense | /ratings/sp | unprobed | unprobed | ⚠️ | prior |
| fpi_overall | /ratings/fpi | unprobed | unprobed | ⚠️ | prior |
| srs_rating | /ratings/srs | unprobed | unprobed | ⚠️ | prior |
| elo_rating | /ratings/elo | unprobed | unprobed | ⚠️ | prior |
| core_overall | /ratings/core | unprobed | unprobed | ⚠️ | prior |
| ppa_offense_overall | /ppa/teams | unprobed | unprobed | ⚠️ | matchup |
| ppa_offense_passing | /ppa/teams | unprobed | unprobed | ⚠️ | matchup |
| ppa_offense_rushing | /ppa/teams | unprobed | unprobed | ⚠️ | matchup |
| ppa_defense_overall | /ppa/teams | unprobed | unprobed | ⚠️ | matchup |
| ppa_defense_passing | /ppa/teams | unprobed | unprobed | ⚠️ | matchup |
| ppa_defense_rushing | /ppa/teams | unprobed | unprobed | ⚠️ | matchup |
| game_ppa_offense | /ppa/games | unprobed | unprobed | ✅ | matchup |
| adv_success_offense | /stats/season/advanced | unprobed | unprobed | ⚠️ | matchup |
| adv_explosiveness_offense | /stats/season/advanced | unprobed | unprobed | ⚠️ | matchup |
| adv_havoc_defense | /stats/season/advanced | unprobed | unprobed | ⚠️ | matchup |
| adv_line_yards_offense | /stats/season/advanced | unprobed | unprobed | ⚠️ | matchup |
| adv_stuff_rate_defense | /stats/season/advanced | unprobed | unprobed | ⚠️ | matchup |
| adv_points_per_opportunity | /stats/season/advanced | unprobed | unprobed | ⚠️ | matchup |
| adv_standard_downs | /stats/season/advanced | unprobed | unprobed | ⚠️ | matchup |
| game_adv_success | /stats/game/advanced | unprobed | unprobed | ✅ | matchup |
| pace_plays | /stats/season/advanced | unprobed | unprobed | ⚠️ | matchup |
| qb_ppa_season | /ppa/players/season | unprobed | unprobed | ⚠️ | qb |
| qb_usage | /player/usage | unprobed | unprobed | ⚠️ | qb |
| qb_passing_stats | /stats/player/season | unprobed | unprobed | ⚠️ | qb |
| returning_production | /player/returning | unprobed | unprobed | ✅ | prior |
| team_talent | /talent | unprobed | unprobed | ✅ | prior |
| recruiting_team | /recruiting/teams | unprobed | unprobed | ✅ | prior |
| transfer_portal | /player/portal | unprobed | unprobed | ✅ | prior |
| roster | /roster | unprobed | unprobed | ✅ | prior |
| coaching | /coaches | unprobed | unprobed | ✅ | prior |
| hfa | internal | ✅ | ✅ | ✅ | context |
| neutral_site | /games | unprobed | unprobed | ✅ | context |
| weather | /games/weather | unprobed | unprobed | ✅ | context |
| venue_altitude | /venues | unprobed | unprobed | ✅ | context |
| rest_days | /games | unprobed | unprobed | ✅ | context |
| closing_lines | /lines | unprobed | unprobed | ❌ model | evaluation |
| pregame_wp | /metrics/wp/pregame | unprobed | unprobed | ❌ model | evaluation |