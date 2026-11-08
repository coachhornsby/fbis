# Offline NBA research context

Run `node scripts/nba-research-snapshot.mjs authorized-local-input.json` to calculate a research feature vector from existing inputs. No fetches, database reads, uploads, collectors or scheduled jobs are added. This is not wired into production recovery. All output remains non-authorizing and non-qualifying.

## Input contract

- `game`: id, homeId, awayId, start (ISO timestamp), homeAbbr, awayAbbr and an explicit boolean neutralSite. Confirmed normal home venues use the existing static arena table. Neutral or unknown venues require `venueGeo` with numeric lat/lon/altitudeFt and an IANA tz. Do not infer a neutral venue from the designated home team.
- `asOf`: pre-tip research checkpoint. Every admitted observation must already have existed at this point.
- `scheduleSource`: attributed source identifier.
- `scheduleObservedAt`: source snapshot observation timestamp, within 24 hours of the checkpoint and not in its future.
- `scheduleCompleteSince`: source-verified coverage boundary, including all team games for the prior six days and the previous game. Do not manufacture completeness from whichever rows happen to be present.
- `games`: previous game rows using the game shape plus final:true, source, observedAt and completedAt (completion <= observation <= snapshot). Future games and duplicate IDs are excluded; unresolved participation before the target blocks context. Rest uses destination-local calendar dates, not rounded elapsed 24-hour intervals. Travel is arena-to-arena distance, not a verified team itinerary.
- `personnelRows`: game_id/gameId, team_id/teamId, player_id/playerId, observed_at/observedAt, source and status/lineup_status. Must match the exact game and team. Latest eligible observation per player is retained. Default maximum age 24 hours; may be tightened, not loosened. Rows alone cannot prove complete roster availability or supply impact values.
- `homeHistory`/`awayHistory`: existing model history rows plus gameId, teamId, source, final:true, date/start, observedAt and completedAt (start <= completion <= observation <= checkpoint). Historical box-score pointsFor/pointsAgainst and possessions are required by the incumbent model. Do not copy today's retrieval timestamp into a historical as-of backtest.

## Current limitations

Personnel statuses are retained with timestamps and source, but not converted to invented player-impact points. Verified full roster coverage, validated player impacts, calibrated context coefficients, and executable market prices remain blockers. Missing rest/travel context blocks feature generation instead of silently imputing zero travel. Numerical outputs are research only. No Dunks & Threes API entitlement, subscriber copying or scraping is implied. An authorized private CSV can be examined separately; no Dunks data is in this change.

Synthetic offline fixtures verify behavior; they are not evidence that today's feeds or production integrations are complete. The existing persisted injury/lineup schemas use team keys, so a separately verified team-key-to-ID mapping is required before passing those rows here. Existing recovery history lacks some required provenance fields and must not be silently relabeled to satisfy this contract.

## Recovery runner shadow connection

The four-sport recovery runner now preserves already-fetched ESPN historical schedule and box-summary observations. It clones and bounds the two already-fetched current-day NBA raw scoreboard responses, retaining both actual URL dates rather than only games normalized to the selected Central date. There are no additional provider requests.

`receipt.json` includes `nbaContextShadow` records with baseline, optional context-adjusted research forecast and paired differences. Published projection packets still use the unchanged incumbent projection. Missing coverage/neutral venue/history evidence suppresses the shadow forecast, not the incumbent. Shadow failures are caught separately.

ESPN does not provide a verified exact final-whistle timestamp here. A captured FINAL status provides a completion upper bound; this is explicitly labeled `observed_final_upper_bound`. It is sufficient to prove that the game was complete by a later checkpoint, but must not be presented as its actual ending time. Current collection is not a historical as-of backtest.

This is operational plumbing for prospective paired validation, not validation of context coefficients. Personnel remains absent from the runner and explicitly unverified. No Dunks subscriber data or new source collection is added.
