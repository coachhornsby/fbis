# CFBD feature availability (live audit)

**Production SHA:** `23530f6b0f1ce1ad860f42dca09a59416cf8c147`  
**Audited at:** 2026-09-10T15:18:51Z  
**CI:** https://github.com/coachhornsby/fbis/actions/runs/34494494911  
**Artifact:** `cfbd-endpoint-audit-23530f6b0f1ce1ad860f42dca09a59416cf8c147`

## Classification summary

| Class | Count |
|---|---|
| AVAILABLE | 84 |
| AVAILABLE-BUT-EMPTY | 2 |
| NOT-ENTITLED | 0 |
| DEPRECATED | 4 |
| INVALID-PARAMETERS | 8 |
| AUTH-FAILURE | 0 |
| TRANSIENT-FAILURE | 0 |

### Working endpoint paths (unique AVAILABLE)
See `data/cfbd/audits/live-23530f6.json` summary.available (43 unique paths including SP+/FPI/SRS/Elo/CORE, PPA team/game/player, advanced season/game, weather, lines, talent, returning, recruiting, portal, roster, coaches, plays, drives, scoreboard).

### Unavailable / bad probes
- **DEPRECATED:** `/play/types`, `/play/stat/types`
- **INVALID-PARAMETERS (with current probe query):** `/ppa/predicted`, `/game/box/advanced`, `/live/plays`, `/metrics/wp`
- **NOT-ENTITLED:** none

### Temporal classes
- **A** pre-kickoff safe directly
- **B** safe if week/game filtered
- **C** reconstruct from game/play for historical backtests
- **D** not safe as same-season aggregate without dated observation (use prior-season freeze)
- **E** evaluation-only — never independent score

`/ratings/core` returns `throughWeek` / `throughSeasonType` — prefer week-bounded CORE over undated SP+ when reconstructing in-season strength.

| Feature | Endpoint | 2026? | Historical? | Pregame-safe? | Temporal | Use |
|---|---|---|---|---|---|---|
| sp_plus_overall | /ratings/sp | ✅ | ✅ | ⚠️ | D | prior |
| sp_plus_offense | /ratings/sp | ✅ | ✅ | ⚠️ | D | prior |
| sp_plus_defense | /ratings/sp | ✅ | ✅ | ⚠️ | D | prior |
| fpi_overall | /ratings/fpi | ✅ | ✅ | ⚠️ | D | prior |
| srs_rating | /ratings/srs | ✅ | ✅ | ⚠️ | D | prior |
| elo_rating | /ratings/elo | ✅ | ✅ | ⚠️ | D | prior |
| core_overall | /ratings/core | ✅ | ✅ | ⚠️ | D | prior |
| ppa_offense_overall | /ppa/teams | ✅ | ✅ | ⚠️ | C | matchup |
| ppa_offense_passing | /ppa/teams | ✅ | ✅ | ⚠️ | C | matchup |
| ppa_offense_rushing | /ppa/teams | ✅ | ✅ | ⚠️ | C | matchup |
| ppa_defense_overall | /ppa/teams | ✅ | ✅ | ⚠️ | C | matchup |
| ppa_defense_passing | /ppa/teams | ✅ | ✅ | ⚠️ | C | matchup |
| ppa_defense_rushing | /ppa/teams | ✅ | ✅ | ⚠️ | C | matchup |
| game_ppa_offense | /ppa/games | ✅ | ✅ | ✅ | A | matchup |
| adv_success_offense | /stats/season/advanced | ✅ | ✅ | ⚠️ | C | matchup |
| adv_explosiveness_offense | /stats/season/advanced | ✅ | ✅ | ⚠️ | C | matchup |
| adv_havoc_defense | /stats/season/advanced | ✅ | ✅ | ⚠️ | C | matchup |
| adv_line_yards_offense | /stats/season/advanced | ✅ | ✅ | ⚠️ | C | matchup |
| adv_stuff_rate_defense | /stats/season/advanced | ✅ | ✅ | ⚠️ | C | matchup |
| adv_points_per_opportunity | /stats/season/advanced | ✅ | ✅ | ⚠️ | C | matchup |
| adv_standard_downs | /stats/season/advanced | ✅ | ✅ | ⚠️ | C | matchup |
| game_adv_success | /stats/game/advanced | ✅ | ✅ | ✅ | A | matchup |
| pace_plays | /stats/season/advanced | ✅ | ✅ | ⚠️ | C | matchup |
| qb_ppa_season | /ppa/players/season | ✅ | ✅ | ⚠️ | D | qb |
| qb_usage | /player/usage | ✅ | ✅ | ⚠️ | D | qb |
| qb_passing_stats | /stats/player/season | ✅ | ✅ | ⚠️ | D | qb |
| returning_production | /player/returning | ✅ | ✅ | ✅ | A | prior |
| team_talent | /talent | ✅ | ✅ | ✅ | D | prior |
| recruiting_team | /recruiting/teams | ✅ | ✅ | ✅ | D | prior |
| transfer_portal | /player/portal | ✅ | ✅ | ✅ | A | prior |
| roster | /roster | ✅ | ✅ | ✅ | A | prior |
| coaching | /coaches | ✅ | ✅ | ✅ | D | prior |
| hfa | internal | ✅ | ✅ | ✅ | A | context |
| neutral_site | /games | ✅ | ✅ | ✅ | A | context |
| weather | /games/weather | ✅ | ✅ | ✅ | B | context |
| venue_altitude | /venues | ✅ | ✅ | ✅ | A | context |
| rest_days | /games | ✅ | ✅ | ✅ | A | context |
| closing_lines | /lines | ✅ | ✅ | ❌ model | E | evaluation |
| pregame_wp | /metrics/wp/pregame | ✅ | ✅ | ❌ model | E | evaluation |

