# FBIS CBB roster and historical-stat evidence phase

This phase builds private roster evidence from previously captured data. It does not change the CBB-PRO model, publish projections, collect new provider data or estimate injuries/current playing time.

## Schema and historical coverage

The hoopR maintainer's `R/torvik_player_stats.R` documents the 67-column season file. Reviewed blob: 2266bffd2b733880c4d7aab22013f57f8d339c12, https://github.com/sportsdataverse/hoopR/blob/main/R/torvik_player_stats.R. This is an external parser definition, not an official Torvik schema contract. Columns used: games 3; percentage of available minutes 4; offensive rating 5; usage percentage 6; shooting totals 13/14, 16/17, 19/20; height 26; season 31; player ID 32; hometown 33. Percentages retain 0–100 units. The field named `minutes` at 54 and `recruit_date` at 66 are deliberately excluded pending additional definition checks; no date-of-birth or game minutes are inferred from them.

All 4,978 season profiles reconcile with the historical game file after resolving 58 cross-file ID differences. Each bridge requires one exact normalized name/team group, identical games played and all six shooting totals (makes AND attempts for free throws, twos and threes). Original season and game IDs remain separate with evidence labels. No source ID is rewritten. Direct and bridged profiles also check game-file names, teams, games played and scoring totals. One game-file player remains without a season profile: Ryan Conway, Towson, game-file ID 133809, 22 games. His data is retained without inventing a season rating/usage.

## Current roster identity

From 5,543 current roster records, 1,578 have a unique name candidate corroborated by exact height and exact hometown city/state. Of these, 870 show the same school, 707 show a different school, and one has unresolved prior-school mapping. This is multi-attribute evidence, NOT an official provider-issued ESPN/Torvik crosswalk. Every record states officialProviderCrosswalk=false. All 1,578 have consistent prior-season production, minutes percentage and usage evidence.

Another 1,316 records have only a unique name candidate; 63 have ambiguous names or duplicate identity; 2,586 lack an exact prior-season name match. These do not receive prior production automatically. Suffixes are preserved, no fuzzy matching is used, and no missing player is declared a freshman, departure, transfer, injured or healthy. No prior player can attach to two current records. A school change is an observed membership comparison, not a verified portal transaction or eligibility finding.

Produced evidence for all 365 teams. Returning-minutes percentages remain null because partial identity coverage and historical minute shares do not establish complete current rotations or a correct team denominator. No score adjustment or expected current minutes are supplied. This phase enables research on roster priors; it does not finalize a roster-impact model.

## Reproduce and validate

After the earlier verified delivery/staging phase, save the pinned parser readback as artifacts/cbb-roster-evidence/hoopr-schema-source.json and run `python scripts/cbb-roster-evidence.py`. Outputs stay under ignored artifacts and must remain in private Drive storage.

Run `PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s test -p 'test_cbb*.py'`: 15 tests pass, including the 6 prior staging regressions and 9 new roster/schema/identity-bridge tests. These reject wrong seasons/schema/percentage scales, missing corroboration, suffix/height/location conflicts, ambiguous bridges, differing shooting attempts and reused player-game IDs. The earlier 51 college tests remain applicable to the unchanged status repair; no runtime code changes in this phase.

## Grok's useful next work

Use the private unresolved queue for source-linked identity evidence: prioritize the 63 ambiguous records, then the 1,316 name-only records. Seek official team/player bios or provider-issued ID crosswalks, with source URLs, seasons and timestamps; do not relax height/name rules automatically or do a broad bulk scrape. Investigate Ryan Conway's missing season profile and the unresolved historical Saint Francis school mapping. Keep current injuries/expected starters separate from roster membership. Do not modify model weights, enable collectors or deploy. A separate prospective source scoreboard still requires genuine pick-time lines for pick-source ATS/CLV; no token parsing of Notes establishes a verified betting edge.
