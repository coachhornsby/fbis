# FBIS CBB — provider inventory and system handoff

As of November 2, 2026 UTC / November 1, 2026 Central. FBIS only; no FMIS work. Season 2027 means 2026–27.

## Read this first

This lists the documented data surfaces, what FBIS actually captured, what the source code requests, the consumer, and the reason for not collecting the rest. Documented availability does not prove paid-account entitlement or a successful import. An adapter in GitHub does not prove that a collector is running. No recurring provider collectors were resumed.

Coverage: all 40 GET paths in the current CBBD OpenAPI schema; all 11 endpoints in KenPom’s official API documentation; 23 data families in the toRvik author’s reference; additional KenPom subscriber-page features. Torvik does not supply a verified complete public API contract here, so undocumented site tables are not represented as guaranteed pullable. Website membership and API access are separate.

## Captured and verified

- ESPN, separately from these three providers: 365 current-season team rosters, 5,543 players. Exact season/team IDs validated. Availability remains UNKNOWN.
- CBBD current roster response contains 1,544 program entries. Filtering against its verified 365-team Division I directory yields 365 teams and 5,541 players. Two ESPN-only records were retained and logged, not deleted: Channing Francis (cbb-2099) and Trey Lewis (cbb-2640). Non-Division-I entries are archived but excluded from the operating D1 store.
- KenPom seven-feed capture: 365 teams per feed, all 365 matched, including coaches/arenas. 363 teams have zero played games; the normalized importer retains preseason ratings/height context but nulls their placeholder game-derived statistics.
- CBBD current adjusted ratings are HTTP 200 with zero rows; prior-season adjusted ratings contain 365 teams. The bounded current box/leaderboard responses contain two team records (one game). No prior-season rating is relabeled current and no full CBB production readiness is claimed.
- Torvik current ratings: 365 rows, 365 distinct CBB IDs, zero unresolved.
- Torvik current four-factor CSV: 365 rows, 365 distinct CBB IDs, zero unresolved; all eight core four-factor fields present for all 365 teams. Also includes two/three-point offense/defense percentages.
- Earlier roster/ratings archive was independently downloaded and restored in SQLite. Its Drive ID is 1m3bPodgfT-ESQBstwKG4T8X6D0C5V8Jk.
- New merged Torvik archive: https://drive.google.com/file/d/1tJASpVptiIUlnTLFb3aTi8UrME1CCMWp/view . Independently downloaded, all member hashes checked and 365 rows restored into isolated SQLite.
- Authenticated raw archive: https://drive.google.com/file/d/1zMC-68JGjYO3-Xly02SXZrO7SbxfnVVB/view . Independently downloaded, all 19 member files checked, and all 730 normalized KenPom/CBBD provider rows restored with matching hashes.
- Current compact team store is CBB_DB.cbb_current_team_inputs, primary key (season, team_id). Merged Torvik ratings/factors also have 365 verified rows in cbb_current_provider_inputs, keyed by (season, provider, team_id), with zero readback mismatches. These remain staged evidence, not an approved production cutover.

Authenticated runtime capture: 13 provider network attempts. Results below are from durable receipts, not inferred from configured key names.

- cbbd / directory: HTTP 200; rows 365; captured.
- cbbd / roster: HTTP 200; rows 1544; captured.
- cbbd / adjusted-current: HTTP 200; rows 0; captured.
- cbbd / team-leaderboard: HTTP 200; rows 2; captured.
- cbbd / game-teams-current: HTTP 200; rows 2; captured.
- cbbd / adjusted-prior: HTTP 200; rows 365; captured.
- kenpom / ratings: HTTP 200; rows 365; captured.
- kenpom / four-factors: HTTP 200; rows 365; captured.
- kenpom / pointdist: HTTP 200; rows 365; captured.
- kenpom / height: HTTP 200; rows 365; captured.
- kenpom / misc-stats: HTTP 200; rows 365; captured.
- kenpom / archive: HTTP 200; rows 365; captured.
- kenpom / teams: HTTP 200; rows 365; captured.
## KenPom — all documented API feeds

Authentication: stored Bearer API credential; ending-year parameter y=2027. The recurring adapter requests ratings, four-factors, pointdist, height and misc-stats and caches them for six hours when its code is executed; the board’s current static release does not execute that adapter. Archive and FanMatch have separate research/comparison readers. The one-time recovery also requests team metadata and preseason archive.

### ratings

- Available: Adjusted/raw offense and defense, tempo, net strength, luck, schedule strength, possession length, ranks and coach/context.
- Pull status: captured 365 rows in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 365 rows.
- Use / exclusion: Side projection uses adjusted offense/defense/tempo; other fields support context/research. Rank/luck is not an extra unvalidated weight.
- Exact documented fields: `DataThrough`, `Season`, `TeamName`, `Seed`, `ConfShort`, `Coach`, `Wins`, `Losses`, `AdjEM`, `RankAdjEM`, `Pythag`, `RankPythag`, `AdjOE`, `RankAdjOE`, `OE`, `RankOE`, `AdjDE`, `RankAdjDE`, `DE`, `RankDE`, `Tempo`, `RankTempo`, `AdjTempo`, `RankAdjTempo`, `Luck`, `RankLuck`, `SOS`, `RankSOS`, `SOSO`, `RankSOSO`, `SOSD`, `RankSOSD`, `NCSOS`, `RankNCSOS`, `Event`, `APL_Off`, `RankAPL_Off`, `APL_Def`, `RankAPL_Def`, `ConfAPL_Off`, `RankConfAPL_Off`, `ConfAPL_Def`, `RankConfAPL_Def`.

### archive

- Available: Dated and preseason ratings plus final-season comparison fields.
- Pull status: captured 365 rows in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 365 rows.
- Use / exclusion: Use only values known at the projection timestamp. Final fields are excluded from pregame features to prevent future leakage.
- Exact documented fields: `ArchiveDate`, `Season`, `Preseason`, `TeamName`, `Seed`, `Event`, `ConfShort`, `AdjEM`, `RankAdjEM`, `AdjOE`, `RankAdjOE`, `AdjDE`, `RankAdjDE`, `AdjTempo`, `RankAdjTempo`, `AdjEMFinal`, `RankAdjEMFinal`, `AdjOEFinal`, `RankAdjOEFinal`, `AdjDEFinal`, `RankAdjDEFinal`, `AdjTempoFinal`, `RankAdjTempoFinal`, `RankChg`, `AdjEMChg`, `AdjTChg`.

### four-factors

- Available: Offensive/defensive shooting, turnovers, rebounding, free-throw rates plus ratings/ranks.
- Pull status: captured 365 rows in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 365 rows.
- Use / exclusion: Matchup evidence and shadow four-factor challenger; not an automatic change to frozen CBB-PRO coefficients.
- Exact documented fields: `DataThrough`, `ConfOnly`, `TeamName`, `Season`, `eFG_Pct`, `RankeFG_Pct`, `TO_Pct`, `RankTO_Pct`, `OR_Pct`, `RankOR_Pct`, `FT_Rate`, `RankFT_Rate`, `DeFG_Pct`, `RankDeFG_Pct`, `DTO_Pct`, `RankDTO_Pct`, `DOR_Pct`, `RankDOR_Pct`, `DFT_Rate`, `RankDFT_Rate`, `OE`, `RankOE`, `DE`, `RankDE`, `Tempo`, `RankTempo`, `AdjOE`, `RankAdjOE`, `AdjDE`, `RankAdjDE`, `AdjTempo`, `RankAdjTempo`.

### pointdist

- Available: Shares of points from free throws, twos and threes on offense/defense, ranks.
- Pull status: captured 365 rows in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 365 rows.
- Use / exclusion: Game-page matchup context and research; not consumed directly by the frozen side gate or native total.
- Exact documented fields: `DataThrough`, `ConfOnly`, `Season`, `TeamName`, `ConfShort`, `OffFt`, `RankOffFt`, `OffFg2`, `RankOffFg2`, `OffFg3`, `RankOffFg3`, `DefFt`, `RankDefFt`, `DefFg2`, `RankDefFg2`, `DefFg3`, `RankDefFg3`.

### height

- Available: Average/effective/position height, experience, bench and continuity, ranks.
- Pull status: captured 365 rows in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 365 rows.
- Use / exclusion: Team/matchup context; not an injury feed and not a validated automatic roster adjustment.
- Exact documented fields: `DataThrough`, `Season`, `TeamName`, `ConfShort`, `AvgHgt`, `AvgHgtRank`, `HgtEff`, `HgtEffRank`, `Hgt5`, `Hgt5Rank`, `Hgt4`, `Hgt4Rank`, `Hgt3`, `Hgt3Rank`, `Hgt2`, `Hgt2Rank`, `Hgt1`, `Hgt1Rank`, `Exp`, `ExpRank`, `Bench`, `BenchRank`, `Continuity`, `RankContinuity`.

### misc-stats

- Available: Two/three/free-throw percentages; blocks, steals, assists, turnovers, shot rates/distances and opponent versions, ranks.
- Pull status: captured 365 rows in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 365 rows.
- Use / exclusion: Explanatory matchup features/research; no silent coefficient changes.
- Exact documented fields: `DataThrough`, `ConfOnly`, `Season`, `TeamName`, `ConfShort`, `FG3Pct`, `RankFG3Pct`, `FG2Pct`, `RankFG2Pct`, `FTPct`, `RankFTPct`, `BlockPct`, `RankBlockPct`, `StlRate`, `RankStlRate`, `NSTRate`, `RankNSTRate`, `ARate`, `RankARate`, `F3GRate`, `RankF3GRate`, `AdjOE`, `RankAdjOE`, `Avg2PADist`, `RankAvg2PADist`, `OppFG3Pct`, `RankOppFG3Pct`, `OppFG2Pct`, `RankOppFG2Pct`, `OppFTPct`, `RankOppFTPct`, `OppBlockPct`, `RankOppBlockPct`, `OppStlRate`, `RankOppStlRate`, `OppNSTRate`, `RankOppNSTRate`, `OppARate`, `RankOppARate`, `OppF3GRate`, `RankOppF3GRate`, `AdjDE`, `RankAdjDE`, `OppAvg2PADist`, `RankOppAvg2PADist`.

### fanmatch

- Available: Dated game IDs, teams, venue class, ranks, predicted scores, win probability, tempo and thrill rating.
- Pull status: comparison adapter wired; not in this capture.
- Use / exclusion: A provider prediction, not independent raw performance. Use as benchmark only; API documents current/past dates rather than unrestricted future access.
- Exact documented fields: `Season`, `GameID`, `DateOfGame`, `Visitor`, `Home`, `Location`, `HomeRank`, `VisitorRank`, `HomePred`, `VisitorPred`, `HomeWP`, `PredTempo`, `ThrillScore`.

### conf-ratings

- Available: Conference IDs/names/rank and strength rating.
- Pull status: not collected.
- Use / exclusion: Native FBIS derives conference strength independently; no validated incremental use of this additional provider rating.
- Exact documented fields: `Season`, `ConfShort`, `ConfID`, `ConfLong`, `Rank`, `Rating`.

### program-ratings

- Available: Long-run program strength/ranks, best/worst/median finishes and tournament milestones.
- Pull status: not collected.
- Use / exclusion: Not a validated current roster/team feature; newest-only values risk future leakage in historical backtests.
- Exact documented fields: `TeamID`, `TeamName`, `ConfShort`, `Season`, `Rank`, `Rating`, `Best`, `Worst`, `Med`, `Top10`, `Top25`, `Top50`, `SeasonBest`, `SeasonWorst`, `CH`, `F4`, `S16`, `R1`, `PrevRank`, `RankChg`.

### teams

- Available: Season IDs, school names, conferences, coaches and arenas/cities/states.
- Pull status: captured 365 rows in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 365 rows.
- Use / exclusion: Provider-ID crosswalk, coach and venue metadata; IDs remain provider scoped.
- Exact documented fields: `Season`, `TeamName`, `TeamID`, `ConfShort`, `Coach`, `Arena`, `ArenaCity`, `ArenaState`.

### conferences

- Available: Season conference IDs, short and long names.
- Pull status: not collected.
- Use / exclusion: Already represented in team/directory metadata; fetch if exact KenPom conference IDs become necessary.
- Exact documented fields: `Season`, `ConfID`, `ConfShort`, `ConfLong`.

## KenPom — member pages outside the documented API

The official member tour also shows the following surfaces. We are not automatically scraping them. No API endpoint or entitlement is invented for a website feature. Existing access rights must permit automation; do not purchase another plan or bypass a login/bot block.

- Player season/advanced stats and biographies: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.
- Player game logs and conference/top-opponent splits: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.
- Minutes matrix, starts, depth charts and lineup usage: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.
- Box scores, DNP records and win-probability charts: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.
- Future FanMatch website schedule/predictions: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.
- Team and coach historical pages: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.
- Home-court ratings: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.
- Referee/officiating ratings: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.
- Jump-ball ratings: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.
- Arena capacity: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.
- D-I statistical trends and conference selections: Visible subscriber content is not proof that our API entitlement exposes it. No undocumented scraper, new purchase or model change is being assumed.

Exact use distinction: adjusted offense, defense and tempo drive the KenPom-derived FBIS side score. Four factors support matchup evidence/shadow comparisons. Point distribution, height/experience/continuity and miscellaneous statistics are retained/exposed as context and research; they are not all numerical inputs to CBB-PRO-v1. FanMatch predictions are benchmark-only. Raw archived response fields and ranks are not automatically used as model features.

## Torvik — documented data families

Current adapter sources are https://barttorvik.com/2027_team_results.csv and https://barttorvik.com/2027_fffinal.csv. The adapter’s 24-hour cache is not an active schedule. Only these two current team feeds are verified in this mission. The remaining families below are documented by the toRvik package author; their live access, historical depth and automation permissions are unverified here. No scraper was installed or run.

### bart_ratings

- Available: Season team adjusted ratings, efficiency, tempo, record, schedule strength, barthag and WAB.
- Pull status: captured 365 teams.
- Use / exclusion: Current reference/challenger; never an input to the independent native total.

### bart_conf_factors

- Available: Conference aggregate four factors.
- Pull status: not collected.
- Use / exclusion: Duplicates context; native conference strength is derived from game boxes.

### bart_factors

- Available: Team four-factor splits by date, opponent, venue and game type.
- Pull status: captured and verified, 365 teams.
- Use / exclusion: Matchup evidence/shadow model. Complex web splits are not fetched because no promoted split correction exists.

### bart_archive

- Available: Point-in-time T-Rank ratings.
- Pull status: not collected.
- Use / exclusion: Historical as-of research only; not needed to duplicate the current snapshot.

### bart_season_schedule

- Available: Season fixtures, results and predictions.
- Pull status: not collected.
- Use / exclusion: ESPN supplies the live schedule; CBBD supplies completed game evidence.

### bart_team_schedule

- Available: Single-team schedule/results.
- Pull status: not collected.
- Use / exclusion: Avoid one-request-per-team duplication of the bulk schedule.

### bart_pregame

- Available: Pregame probability/prediction feed.
- Pull status: not collected.
- Use / exclusion: Benchmark only; no unvalidated provider-prediction ensemble weight.

### bart_player_game

- Available: Player box scores/game logs.
- Pull status: not collected.
- Use / exclusion: Use CBBD player logs for a single canonical player pipeline before adding a duplicate feed.

### bart_player_season

- Available: Season player advanced production, shooting, usage and efficiency.
- Pull status: not collected.
- Use / exclusion: Additional source join/coverage burden; no promoted game-model coefficient uses it.

### bart_transfers

- Available: Transfer records/history.
- Pull status: not collected.
- Use / exclusion: Roster membership is captured elsewhere; transfer impact requires validated role/minutes modeling.

### bart_game_box

- Available: Team game box scores.
- Pull status: not collected.
- Use / exclusion: Native model uses CBBD boxes; a second copy would add reconciliation work.

### bart_game_factors

- Available: Per-game four-factor statistics.
- Pull status: not collected.
- Use / exclusion: Derive from canonical CBBD boxes; no need for a second full history.

### bart_team_shooting

- Available: Team shot-location/shooting splits.
- Pull status: not collected.
- Use / exclusion: Research-only shot-profile hypothesis; no promoted adjustment.

### bart_team_box

- Available: Aggregate/per-game team box splits.
- Pull status: not collected.
- Use / exclusion: Existing canonical boxes/leaderboard cover the operating need.

### bart_team_history

- Available: Historical team metrics.
- Pull status: not collected.
- Use / exclusion: Restore selected historical partitions for backtests; do not refill D1 with an entire duplicate history.

### bart_conf_stats

- Available: Conference statistics.
- Pull status: not collected.
- Use / exclusion: No extra validated coefficient beyond current independent conference strength.

### bart_tourney_results

- Available: Tournament history/results.
- Pull status: not collected.
- Use / exclusion: Not required for current-season operation; targeted backtest only.

### bart_tourney_sheets

- Available: Tournament committee profiles.
- Pull status: not collected.
- Use / exclusion: Selection context is not a validated betting feature.

### bart_tourney_odds

- Available: Tournament probability estimates.
- Pull status: not collected.
- Use / exclusion: Different target market and provider model; no tournament wagering model is authorized.

### bart_coach

- Available: Coaching history and recruit context.
- Pull status: not collected.
- Use / exclusion: Current coach metadata comes from team feeds; historical coach effects are not validated.

### bart_coach_change

- Available: Head-coach changes.
- Pull status: not collected.
- Use / exclusion: Potential manual context; no automatic additive coaching effect.

### bart_injuryimpact

- Available: Estimated effect of removing a player.
- Pull status: not collected.
- Use / exclusion: An estimated model effect is not a verified injury/availability report. Do not label it as one.

### bart_poy

- Available: Player-of-year model ratings.
- Pull status: not collected.
- Use / exclusion: Award model does not establish per-game value or an approved player-prop edge.

Torvik normalized fields currently retained: team, conference, games, adjOe, adjDe, tempo, barthag, wab, source; four-factor fields efgPct, efgPctD, tovRate, tovRateD, orbRate, drbRate, ftr, ftrD; twoPtPct, twoPtPctD, threePtPct, threePtPctD. Canonical/ESPN identity and source timestamps are attached separately. Raw team-results CSV contains additional ranks/projections/SOS columns; they are archived, but the current normalizer does not feed all of them into the model. A Torvik projection is not an independent FBIS-native feature.

## CBBD — all 40 documented GET endpoints

Authentication: stored shared college-data Bearer credential, with durable request reservations, daily/monthly caps and provider-remaining stop. The current schema and 1,405 field paths are included in provider-inventory.json and cbbd-field-dictionary.csv. Each row below states the operating decision; exact fields and required/optional parameters are in those machine-readable appendices. No endpoint was probed merely to see what it returns.

CBBD IDs are provider scoped; directory sourceId / roster teamSourceId and exact school mappings must establish the ESPN/canonical crosswalk. Never treat a CBBD teamId as an ESPN ID. /teams/directory returns an object containing teams/conferences, unlike array response feeds. /ratings/adjusted does not document tempo: the existing baseline uses 68 when no pace is present. That is a model assumption, not a measured CBBD pace value. Do not advertise it as observed data.

Current game/team statistics are date-bounded. Provider game/game-team/player result caps mean a single full-season response does not establish completeness. Historical imports need stable windows, cap detection, ID deduplication and manifests; do not restart broad scans or count jobs.

### GET /venues

- Pull status: catalog only.
- Use: Arena metadata/context.
- Why / constraint: ESPN already supplies venues; no validated venue covariate requires a second bulk copy.
- Parameters: none.
- Documented response fields: 6 paths; see exact field dictionary.

### GET /teams/directory

- Pull status: captured 365 response records in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 365 records.
- Use: Season/team/conference register and provider-ID crosswalk.
- Why / constraint: Required identity foundation; object envelope is handled separately from array feeds.
- Parameters: season [required].
- Documented response fields: 13 paths; see exact field dictionary.

### GET /teams/{teamId}/season/{season}/overview

- Pull status: not collected.
- Use: Potential consolidated team page.
- Why / constraint: Per-team fan-out duplicates bulk directory, ratings and leaderboard data.
- Parameters: teamId [required], season [required].
- Documented response fields: 201 paths; see exact field dictionary.

### GET /teams

- Pull status: wired, paused.
- Use: Legacy reference job/team metadata.
- Why / constraint: Prefer the explicit season directory for current identity; legacy job remains paused.
- Parameters: conference [optional], season [optional].
- Documented response fields: 16 paths; see exact field dictionary.

### GET /teams/roster

- Pull status: captured 1544 response records in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 1544 records.
- Use: Cross-check ESPN rosters, source IDs, measurements and experience.
- Why / constraint: Roster membership is not an injury or confirmed-active designation.
- Parameters: season [required], team [optional].
- Documented response fields: 23 paths; see exact field dictionary.

### GET /substitutions/game/{gameId}

- Pull status: not collected.
- Use: Potential rotation/stint research.
- Why / constraint: No promoted substitution/stint model; high event volume and identity burden.
- Parameters: gameId [required].
- Documented response fields: 19 paths; see exact field dictionary.

### GET /substitutions/player/{playerId}

- Pull status: not collected.
- Use: Potential player rotation research.
- Why / constraint: Same exclusion as substitutions by game; per-player fan-out not justified.
- Parameters: playerId [required], season [required].
- Documented response fields: 19 paths; see exact field dictionary.

### GET /substitutions/team

- Pull status: not collected.
- Use: Potential team rotation research.
- Why / constraint: No validated live consumer; defer until a bounded research question exists.
- Parameters: season [required], team [required].
- Documented response fields: 19 paths; see exact field dictionary.

### GET /stats/team/leaderboard

- Pull status: captured 2 response records in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 2 records.
- Use: Team profiles, efficiency/pace/four-factor context.
- Why / constraint: Bulk feed replaces per-team scans; captured fields are not automatically model coefficients.
- Parameters: season [optional], team [optional], conference [optional].
- Documented response fields: 113 paths; see exact field dictionary.

### GET /stats/team/season

- Pull status: not collected.
- Use: Potential season aggregate cross-check.
- Why / constraint: Bulk leaderboard and derived game/team boxes cover the current use; avoid duplicate storage.
- Parameters: season [optional], seasonType [optional], team [optional], conference [optional], startDateRange [optional], endDateRange [optional].
- Documented response fields: 78 paths; see exact field dictionary.

### GET /stats/team/shooting/season

- Pull status: not collected.
- Use: Potential shot-zone research.
- Why / constraint: No promoted shot-zone correction; requires historical pregame validation.
- Parameters: season [required], seasonType [optional], team [optional], conference [optional], startDateRange [optional], endDateRange [optional].
- Documented response fields: 38 paths; see exact field dictionary.

### GET /stats/player/season

- Pull status: wired, paused.
- Use: Player context, usage, minutes and separate prop research.
- Why / constraint: Not captured in this recovery run; current-season stats may be empty before tipoff. Player features do not automatically change the game model.
- Parameters: season [required], seasonType [optional], team [optional], conference [optional], startDateRange [optional], endDateRange [optional].
- Documented response fields: 47 paths; see exact field dictionary.

### GET /stats/player/shooting/season

- Pull status: not collected.
- Use: Potential player shot-profile research.
- Why / constraint: Separate prop/shot model needs validation; no automatic use in the frozen side/total model.
- Parameters: season [required], seasonType [optional], team [optional], conference [optional], startDateRange [optional], endDateRange [optional].
- Documented response fields: 40 paths; see exact field dictionary.

### GET /recruiting/players

- Pull status: not collected.
- Use: Potential preseason player priors.
- Why / constraint: Recruiting effects and ID joins are not validated production features.
- Parameters: year [optional], team [optional], conference [optional], position [optional].
- Documented response fields: 22 paths; see exact field dictionary.

### GET /recruiting/teams

- Pull status: not collected.
- Use: Potential preseason team priors.
- Why / constraint: Avoid double-counting talent already reflected in provider preseason ratings.
- Parameters: year [optional], team [optional], conference [optional].
- Documented response fields: 6 paths; see exact field dictionary.

### GET /recruiting/portal

- Pull status: not collected.
- Use: Potential roster-change evidence.
- Why / constraint: Current roster already captures membership; transfer impact requires explicit validated minutes/role treatment.
- Parameters: year [optional], sourceTeam [optional], destinationTeam [optional], sourceConference [optional], destinationConference [optional], position [optional].
- Documented response fields: 16 paths; see exact field dictionary.

### GET /ratings/srs

- Pull status: wired, paused.
- Use: Reference/research comparison.
- Why / constraint: Not a CBB-PRO side or total input; paused job must use season, not year.
- Parameters: season [optional], team [optional], conference [optional].
- Documented response fields: 5 paths; see exact field dictionary.

### GET /ratings/adjusted

- Pull status: captured 0 response records in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 0 records.
- Use: Independent CBBD side comparison/confirmation.
- Why / constraint: Current-season and prior-season responses are stored separately; prior is not silently relabeled current.
- Parameters: season [optional], team [optional], conference [optional].
- Documented response fields: 10 paths; see exact field dictionary.

### GET /ratings/elo

- Pull status: wired, paused.
- Use: Historical comparison/baseline.
- Why / constraint: No production Elo ensemble weight; stored only for a bounded research purpose.
- Parameters: season [optional], team [optional], conference [optional].
- Documented response fields: 5 paths; see exact field dictionary.

### GET /rankings

- Pull status: not collected.
- Use: Potential poll context.
- Why / constraint: Poll rank is not a validated incremental feature and may duplicate efficiency information.
- Parameters: season [optional], seasonType [optional], week [optional], pollType [optional], team [optional], conference [optional].
- Documented response fields: 11 paths; see exact field dictionary.

### GET /plays/game/{gameId}

- Pull status: not collected.
- Use: Possession/player model research.
- Why / constraint: Possession research code exists but live collection is paused; no all-games event backfill in this budget run.
- Parameters: gameId [required], shootingPlaysOnly [optional].
- Documented response fields: 44 paths; see exact field dictionary.

### GET /plays/player/{playerId}

- Pull status: not collected.
- Use: Potential player event history.
- Why / constraint: Per-player requests duplicate game events; not needed for the frozen game model.
- Parameters: playerId [required], season [required], shootingPlaysOnly [optional].
- Documented response fields: 44 paths; see exact field dictionary.

### GET /plays/team

- Pull status: not collected.
- Use: Potential team event history.
- Why / constraint: Event volume; prefer bounded game partitions only if research is authorized.
- Parameters: season [required], team [required], shootingPlaysOnly [optional].
- Documented response fields: 44 paths; see exact field dictionary.

### GET /plays/date

- Pull status: not collected.
- Use: Potential daily event batch.
- Why / constraint: Not required for the current box-score model; no recurring event ingestion.
- Parameters: date [required], shootingPlaysOnly [optional], utcOffset [optional].
- Documented response fields: 44 paths; see exact field dictionary.

### GET /plays/tournament

- Pull status: not collected.
- Use: Potential tournament research.
- Why / constraint: Tournament-only data is not needed for the current operating board.
- Parameters: tournament [required], season [required], shootingPlaysOnly [optional].
- Documented response fields: 44 paths; see exact field dictionary.

### GET /plays/types

- Pull status: catalog only.
- Use: Event-type dictionary.
- Why / constraint: Fetch once if event ingestion is introduced; no current consumer.
- Parameters: none.
- Documented response fields: 2 paths; see exact field dictionary.

### GET /lineups/team

- Pull status: not collected.
- Use: Potential lineup/stint impact research.
- Why / constraint: No validated lineup adjustment; lineup history does not prove a future starting lineup.
- Parameters: season [required], team [required], startDateRange [optional], endDateRange [optional].
- Documented response fields: 85 paths; see exact field dictionary.

### GET /lineups/game/{gameId}

- Pull status: not collected.
- Use: Potential game lineup evidence.
- Why / constraint: No current live ingestion/consumer; roster and availability are separate concepts.
- Parameters: gameId [required].
- Documented response fields: 85 paths; see exact field dictionary.

### GET /lines

- Pull status: wired, paused.
- Use: Historical market comparison and walk-forward evaluation.
- Why / constraint: Market data stays outside independent ratings; no fresh quote collection in this capture. Historical timestamps do not automatically establish a verified close.
- Parameters: season [optional], team [optional], conference [optional], startDateRange [optional], endDateRange [optional].
- Documented response fields: 19 paths; see exact field dictionary.

### GET /lines/providers

- Pull status: catalog only.
- Use: Sportsbook/provider dictionary.
- Why / constraint: Only needed with a bounded lines capture; no recurring dictionary fetch.
- Parameters: none.
- Documented response fields: 2 paths; see exact field dictionary.

### GET /games

- Pull status: wired, paused.
- Use: Schedule, final-score/settlement and walk-forward records.
- Why / constraint: Public scoreboard currently uses ESPN; full-season requests can truncate at provider limits.
- Parameters: startDateRange [optional], endDateRange [optional], team [optional], conference [optional], season [optional], seasonType [optional], status [optional], tournament [optional].
- Documented response fields: 39 paths; see exact field dictionary.

### GET /games/media

- Pull status: not collected.
- Use: TV/radio metadata.
- Why / constraint: No projection or settlement value; skip duplicated display-only feed.
- Parameters: startDateRange [optional], endDateRange [optional], team [optional], conference [optional], season [optional], seasonType [optional], tournament [optional].
- Documented response fields: 19 paths; see exact field dictionary.

### GET /games/teams

- Pull status: captured 2 response records in one-time runtime run; recurring collector paused; latest attempt HTTP 200, 2 records.
- Use: Independent FBIS offense/defense, possessions, matchups, schedule and HCA.
- Why / constraint: Completed pregame-available boxes only. Broad full-season loader is not proof of complete ingestion; use date partitions before production.
- Parameters: startDateRange [optional], endDateRange [optional], team [optional], conference [optional], season [optional], seasonType [optional], tournament [optional].
- Documented response fields: 96 paths; see exact field dictionary.

### GET /games/players

- Pull status: wired, paused.
- Use: Recent form/role and player-prop research.
- Why / constraint: 28-day research reader exists but is not active. Needs bounded pagination/date windows and identity checks.
- Parameters: startDateRange [optional], endDateRange [optional], team [optional], conference [optional], season [optional], seasonType [optional], tournament [optional].
- Documented response fields: 60 paths; see exact field dictionary.

### GET /scoreboard

- Pull status: not collected.
- Use: Potential live score alternative.
- Why / constraint: ESPN public scoreboard covers this need; no second live polling loop.
- Parameters: conference [optional].
- Documented response fields: 30 paths; see exact field dictionary.

### GET /draft/teams

- Pull status: not collected.
- Use: Draft metadata.
- Why / constraint: Not a current NCAA game prediction input.
- Parameters: none.
- Documented response fields: 6 paths; see exact field dictionary.

### GET /draft/positions

- Pull status: not collected.
- Use: Draft metadata.
- Why / constraint: No current model consumer.
- Parameters: none.
- Documented response fields: 2 paths; see exact field dictionary.

### GET /draft/picks

- Pull status: not collected.
- Use: Potential historical player pedigree.
- Why / constraint: Post-college outcomes can leak future information in historical training; no validated pregame use.
- Parameters: year [optional], draftTeam [optional], sourceTeam [optional], position [optional].
- Documented response fields: 17 paths; see exact field dictionary.

### GET /conferences

- Pull status: catalog only.
- Use: Conference dictionary.
- Why / constraint: Directory already returns season conferences; avoid duplicate copies.
- Parameters: none.
- Documented response fields: 5 paths; see exact field dictionary.

### GET /conferences/history

- Pull status: not collected.
- Use: Potential historical membership cross-check.
- Why / constraint: Existing season-specific membership registry; historical changes need a targeted reconciliation, not a new recurring feed.
- Parameters: conference [optional].
- Documented response fields: 11 paths; see exact field dictionary.

## How the CBB system works

1. Identity and roster layer. The canonical registry now contains 365 CBB teams; Queens (2511), Southern Indiana (88), and Lindenwood (2815) were added from verified ESPN records. Miami FL/OH now resolve to basketball IDs instead of football IDs. Team/player IDs are source scoped. Current membership, source timestamp, season and unknown health status are stored separately.

2. Provider layer. KenPom, Torvik and CBBD adapters normalize their own ratings/context. They remain separate comparators, not three independent votes. They observe many of the same games; statistical independence has not been established. Market lines are for comparison and decision gates, not inputs to the independent native efficiency fit.

3. Side projection. Current frozen contract is CBB-PRO-v1, version v1.1.0. The side score is FBIS’s formula applied to KenPom adjusted team ratings, not a copy of FanMatch and not a wholly independent FBIS rating system. It compares the KenPom-derived spread with the market. A side candidate needs at least four points of disagreement, CBBD confirmation on the same side, and absolute market spread below 20. Subset tags do not lower that gate. Historical selected-row prices were unavailable and assumed -110 accounting does not establish live profitability. No automatic wagers are authorized.

4. Ratings formula. Expected possessions are the arithmetic mean of team tempos. Expected home efficiency = home AdjOE × away AdjDE / national efficiency; away uses the reverse pairing. Points = expected efficiency × possessions / 100, with neutral/home-court treatment. Total = home + away; margin = home − away. Wrong-scale or missing required inputs must fail closed. The CBBD baseline fallback tempo is a disclosed assumption, not observed pace.

5. Independent native model. FBIS-CBB-RATINGS-v2 v2.0.0 derives opponent-adjusted offense/defense, pace, schedule strength, conference strength, matchup terms and home-court estimates from prior completed CBBD game/team box scores. KenPom ratings, Torvik ratings and sportsbook lines are prohibited inputs. Enforce the pregame cutoff; do not use final-season or postgame information as a historical pregame feature. Current season opening creates an evidence shortage, not permission to fabricate current games or injuries.

6. Total projection. FBIS-CBB-v2-TOTAL adds its frozen residual correction to the native total. Retained artifact results: 2023–24 validation MAE 13.5092 versus KenPom 13.5758; 2025 confirmation MAE 14.4553 versus 14.8974. These are repository artifact results, not a fresh independent rerun or verified live edge. The market-confidence qualification failed, so totals remain PROJECTION_ONLY and cannot qualify wagers. The rejected native margin correction remains disabled. The residual model retains its frozen feature-imputation behavior; no claim is made that every optional residual feature is observed.

7. Player/roster research is separate. Repository code includes season/recent player context and player-prop/possession research. Current roster capture alone does not supply verified injuries, expected minutes, confirmed starters or a validated per-player adjustment to the main side/total score. Missing availability stays UNKNOWN. Do not silently label all players healthy. Props do not inherit game-line approval.

8. Operating board. The website was reopened for schedules/scores with seven sports: NFL, CFB, NBA, CBB, NHL, MLB and Tennis (ATP/WTA views, shared tennis storage). CBB current inputs are staged in dedicated CBB_DB; the production CBB data cutover/prediction publication is not certified by the existence of that table or by passing unit tests. Current provider captures do not themselves finalize the CBB projection system.

9. Storage and cost. Keep compact current team/player/features, fixtures and settlement indices in CBB D1. Keep immutable raw payloads, compressed history, source/schema manifests and recovery evidence under private FBIS_Data in Google Drive. Archive→download→hash→restore validation precedes any deletion. Drive is batch/archive storage, not the public site’s request-time database; no Drive credentials in browser code. No new paid subscription or OpenAI/Gemini model call is required for these data pulls. Cloudflare ceiling remains $10/month including fixed charges/storage/usage/tax; alerts alone are not a hard cap.

10. Runtime import and containment. A short-lived operator route runs the existing stored credentials in the runtime, rather than expecting static builds to receive them. It allows one durable capture, up to six college-data and seven KenPom requests, no retries, bounded response sizes, expiry, and authentication/quota stops. Existing never-attempted CBBD reservations can be atomically claimed without erasing their cost. A temporary internal relay may invoke the capture once; remove its trigger and worker, remove the operator route, and return to static-only deployment when complete. This is not approval to restart the paused collector fleet.

## Implementation checks

106 relevant tests pass. Added the real SQLite quota-ledger CHECK regression, zero-game KenPom placeholder handling, exact provider/season/team lookup tests, missing-input gates, one-use/expiry/authentication/stop tests and a CBBD directory-envelope test. The native reader now refuses a response at the provider 3,000-row cap rather than silently fitting an unproven full season; the collector still needs date-partition completeness before production.

## Corrections for Grok’s earlier CBB note

- VERIFIED from current repo: CBB-PRO-v1 v1.1.0 is the retained main game projection contract. Earlier CBB-ENSEMBLE-v1 / CBB-BET-v1.0 labels are not the current contract.
- VERIFIED from live recovery: the large history/duplicate retirement phase reduced the last measured all-D1 footprint to about 9.003 GB, and current CBB_DB is about 0.568 GB. The earlier statement that the CBB operating database was stuck at a 10 GB limit is stale. These measurements do not certify the current bill.
- VERIFIED from current captures: team/roster and Torvik coverage have changed. An empty tracker tab is not evidence that these source datasets are absent.
- Historical Heritage tickets and screenshots remain retrospective betting records, not pregame model calibration or verified closing-line evidence. No edge is established from them.

## Grok’s role and next actions

Use this inventory and exact source timestamps when writing FBIS CBB intelligence. Log primary links, event time, received time, player/team identity, claim status and source in the FBIS research ledger. Prioritize official injury/availability and starting-lineup evidence missing from the numeric providers. Keep third-party picks and provider predictions labeled as research opinions/benchmarks. Do not change model weights, start collectors, purchase access, mutate production data or authorize wagers based on this message. Do not mix this work into FMIS.

## Field dictionary and catalog files

- Full provider catalog: https://drive.google.com/file/d/1k9d5k_kBNoQlFrO6W2WcTGoKqj3w2pGU/view
- Exact CBBD field dictionary: https://drive.google.com/file/d/1wj2FKeJy_ic-TB1VWqDJllhBLkKBqu-V/view

## Sources and implementation evidence

- KenPom official API: https://kenpom.com/api-documentation.php
- KenPom member tour: https://kenpom.com/tour.php
- CBBD exact current schema: https://api.collegebasketballdata.com/api-docs.json
- CBBD availability: https://api.collegebasketballdata.com/data-availability
- Torvik captured ratings: https://barttorvik.com/2027_team_results.csv
- Torvik captured factors: https://barttorvik.com/2027_fffinal.csv
- toRvik author reference: https://torvik.sportsdataverse.org/reference/index.html
- Repository: functions/lib/collegeApply.js, kenpomCbb.js, torvikCbb.js, cbbRatings.js, cbbFbisRatings.js, cbbFbisV2Total.js, cbbProModel.js, cbbPlayerFeed.js, cfbCfbdAcquisition.js; data/models/cbb-pro-v1.json.
- Supplied FBIS_Drive_Upload.zip was inspected as a legacy source inventory (237 entries). Historical scripts were not executed or activated. The uploaded Home Court Ratings PDF does not override the frozen model’s home-court contract.
