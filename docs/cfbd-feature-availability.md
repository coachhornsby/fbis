# CFBD feature availability

Live entitlement cells remain **unprobed** until the post-deploy `cfbd-endpoint-audit` artifact lands (production SHA must match). Temporal classes:

- **A** pre-kickoff safe directly (prior-season freeze / static)
- **B** safe if week/game filtered
- **C** must reconstruct from game/play data for historical backtests
- **D** not safe for historical backtest as same-season aggregate
- **E** evaluation-only (never independent score)

| Feature | Endpoint | 2026? | Historical? | Pregame-safe? | Temporal | Use |
|---|---|---|---|---|---|---|
| sp_plus_overall | /ratings/sp | unprobed | unprobed | ⚠️ | D | prior |
| sp_plus_offense | /ratings/sp | unprobed | unprobed | ⚠️ | D | prior |
| sp_plus_defense | /ratings/sp | unprobed | unprobed | ⚠️ | D | prior |
| fpi_overall | /ratings/fpi | unprobed | unprobed | ⚠️ | D | prior |
| srs_rating | /ratings/srs | unprobed | unprobed | ⚠️ | D | prior |
| elo_rating | /ratings/elo | unprobed | unprobed | ⚠️ | D | prior |
| core_overall | /ratings/core | unprobed | unprobed | ⚠️ | D | prior |
| ppa_offense_overall | /ppa/teams | unprobed | unprobed | ⚠️ | C | matchup |
| ppa_offense_passing | /ppa/teams | unprobed | unprobed | ⚠️ | C | matchup |
| ppa_offense_rushing | /ppa/teams | unprobed | unprobed | ⚠️ | C | matchup |
| ppa_defense_overall | /ppa/teams | unprobed | unprobed | ⚠️ | C | matchup |
| ppa_defense_passing | /ppa/teams | unprobed | unprobed | ⚠️ | C | matchup |
| ppa_defense_rushing | /ppa/teams | unprobed | unprobed | ⚠️ | C | matchup |
| game_ppa_offense | /ppa/games | unprobed | unprobed | ✅ | A | matchup |
| adv_success_offense | /stats/season/advanced | unprobed | unprobed | ⚠️ | C | matchup |
| adv_explosiveness_offense | /stats/season/advanced | unprobed | unprobed | ⚠️ | C | matchup |
| adv_havoc_defense | /stats/season/advanced | unprobed | unprobed | ⚠️ | C | matchup |
| adv_line_yards_offense | /stats/season/advanced | unprobed | unprobed | ⚠️ | C | matchup |
| adv_stuff_rate_defense | /stats/season/advanced | unprobed | unprobed | ⚠️ | C | matchup |
| adv_points_per_opportunity | /stats/season/advanced | unprobed | unprobed | ⚠️ | C | matchup |
| adv_standard_downs | /stats/season/advanced | unprobed | unprobed | ⚠️ | C | matchup |
| game_adv_success | /stats/game/advanced | unprobed | unprobed | ✅ | A | matchup |
| pace_plays | /stats/season/advanced | unprobed | unprobed | ⚠️ | C | matchup |
| qb_ppa_season | /ppa/players/season | unprobed | unprobed | ⚠️ | D | qb |
| qb_usage | /player/usage | unprobed | unprobed | ⚠️ | D | qb |
| qb_passing_stats | /stats/player/season | unprobed | unprobed | ⚠️ | D | qb |
| returning_production | /player/returning | unprobed | unprobed | ✅ | A | prior |
| team_talent | /talent | unprobed | unprobed | ✅ | D | prior |
| recruiting_team | /recruiting/teams | unprobed | unprobed | ✅ | D | prior |
| transfer_portal | /player/portal | unprobed | unprobed | ✅ | A | prior |
| roster | /roster | unprobed | unprobed | ✅ | A | prior |
| coaching | /coaches | unprobed | unprobed | ✅ | D | prior |
| hfa | internal | ✅ | ✅ | ✅ | A | context |
| neutral_site | /games | unprobed | unprobed | ✅ | A | context |
| weather | /games/weather | unprobed | unprobed | ✅ | B | context |
| venue_altitude | /venues | unprobed | unprobed | ✅ | A | context |
| rest_days | /games | unprobed | unprobed | ✅ | A | context |
| closing_lines | /lines | unprobed | unprobed | ❌ model | E | evaluation |
| pregame_wp | /metrics/wp/pregame | unprobed | unprobed | ❌ model | E | evaluation |
