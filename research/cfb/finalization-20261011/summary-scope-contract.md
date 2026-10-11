# Summary sample scope correction

Upstream primary source: https://github.com/sportsdataverse/cfbfastR-cfb-data/blob/main/R/espn_cfb_15_team_summaries_creation.R

The source builder filters play-by-play where home_division and away_division are both fbs. Its valid_games field counts games where both adjusted offensive and defensive EPA are non-null. A raw comparison against all final games was incorrect: FCS results legitimately contribute to overall records while being excluded from the advanced summary scope.

Intelligence v3 separates sourceFinalGames, sourceFbsFinalGames and excludedNonFbsFinalGames. Summary gaps compare the FBS-only scope and are labeled sample-count gaps, never definitive provider-delay evidence or exact missing-game identity. Non-FBS results remain preserved in team history, while upcoming website cards retain the separate FBS-only visibility contract.

Validation: regression includes final FBS, final FCS and in-progress games, ensuring only FBS finals enter the summary comparison. Production-model coefficients and authority are unchanged. Cache version changes force the corrected response contract. Postflight requires versionv3 and non-FBS counts retained in full records. Rollback by reverting the scope commit; no database changes.
