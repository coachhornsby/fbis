# Inactive verified NFL consumer integration

This change prepares, but does not activate, a pure NFL-only consumer for the
reviewed `nfl-feature-publication-v1` envelope. It uses the actual existing NFL-PRO
scorer, research-board formatter, and NFL player-stat projection layer. No model
coefficients, college inputs, schedules, source collectors, or wager permissions
are changed.

## Admission and time contract

The caller must supply an independently reviewed receipt bound to exact snapshot
bytes and an independently observed complete official season schedule. These
objects are a trusted internal interface, not authentication. Never expose a route
that accepts caller-invented evidence. Completion IDs come from inspected PBP END
GAME evidence and matching team rows; schedule kickoff before cutoff is only an
additional sanity check, not proof of completion.

The consumer checks hash, NFL/current-season scope, 32-team coverage, 10 exact
source URLs, HTTP success, source observation age, upstream modification age,
272 fixtures/17 appearances per team, exact ESPN identity/kickoff/neutral site,
and completed prior-game IDs for both teams. Current team/player/PBP/NGS releases
must be under36hours old; current snaps under96hours; prior-season baseline
updates are not falsely claimed current. All source observations must be under
36hours old. Effective expiry is the earliest source/schedule/build limit.
The publication upper bound is explicitly not a final-whistle timestamp.

Only future scheduled NFL games change. Started/final/unknown/college fixtures
remain unchanged. Validation and model failures preserve the existing forecast.
Player identities/numeric shapes and current recent-game references are checked;
players with absent or any non-current-season recent history are excluded. Valid
current players retain separate prior-season stabilization. Small negative yard
averages are legitimate football data, so yards have bounded signed validation;
counts and standard deviations remain nonnegative. Duplicate recent games fail.
All recognized inherited authorization flags are cleared on changed output.
Existing player-unavailable BLOCKED reasons are retained. Other player results
remain HOLD pending current availability and prospective calibration.

## Public-card transport

`prepareVerifiedNflRecoveryPacket` prepares the current compact NFL packet shape
without writing. It preserves old event objects and records their original
packet-generation times in an NFL-only `eventGeneratedAt` map. The private/public
validators use these per-event times so new inputs cannot restamp started games.
The previous expiry is never renewed. Expired predecessors require a separately
reviewed archival/publication plan, not silent replacement.

The public summary admits only the exact NFL-PRO-v1.2.1 producer-validated source/provenance contract
and checks labels/hash format, not cryptographic score authentication. It emits
derived scores, fixture identities and times, not raw source rows or
receipt hashes. NBA/CFB allowlists are unchanged. Actual route and client matcher
are tested. Player projections are returned separately as private research data;
the current compact public card transport has no player-stat rendering surface.
Do not claim these private rows are already displayed on public cards.

## Real-data result (November8,2026)

Using the gathered source snapshot and independently recorded official schedule,
the offline proof changed eight eligible future game scorelines and121 current
player-stat projections. Seven other upcoming fixtures remained unchanged because
one or both teams had prior games missing from the130-game source receipt.
199 snapshot players were excluded for absent/non-current recent histories.
Examples: TB@CHI total46.8→47.1; Caleb Williams passing yards260.1→261.6.
This compares the actual pre-enrichment feed with PBP-enriched inputs. It is not a
historical backtest, proof of improved accuracy, or production activation.
The evidence files remain outside the repository.

## Remaining production plan

1. Integrate independently reviewed inactive source gateway/writer code and this
   consumer against the current deployment commit; re-run checks.
2. Confirm existing account budget/CPU limits and exact authenticated one-shot
   source inspection/publication/verification scope. Do not change credentials,
   widen access, add collectors, or repurpose college paths.
3. Provide a separately budgeted conditional NFL output-packet publisher. The
   current source writer only stores nfl/features/latest.json, not card packets.
   Pin predecessor hash/etag, retain all original started events, preserve expiry,
   write only exact private/nfl/projections/YYYY-MM-DD.json targets, and verify
   once. Do not run the legacy four-sport recovery writer as a workaround.
4. Deploy the NFL-only public summary/client-validator change, then verify the
   real route/card reflects the expected exact source hash-derived values.
5. Add an explicitly authorized NFL-only private player-projection presentation
   if desired. Until that exists, computed player rows are not a public UI claim.
6. Keep wagers disabled. Calibration requires prospective frozen predictions and
   held-out outcomes; source wiring alone cannot establish betting authority.

## Derived player estimate transport
The same future-game event now contains optional `nflPlayerResearch`: bounded derived player ID/name, team ID, position, stat, estimate and HOLD/BLOCKED status only. Raw source statistics, availability payloads, market lines and wagering permission are excluded. The private packet validator rejects unexpected fields, teams, duplicate player/stat rows, unsafe gates, invalid values and non-NFL attachments. The public summary includes only validated advanced-NFL player estimates. Existing card details render them as uncalibrated research with no availability clearance; expired/started cards retain historical labeling, never become fresh forecasts. Frozen-event byte preservation also covers these nested rows, so score and player outputs use one conditional publication without a new key or storage request. No prop qualification or betting surface is activated.

## Directional and schedule repair (November 9)

The verified consumer now derives the four existing NFL unit-matchup rows from
source EPA inputs and carries them through private/public packets into the board.
The transport validates each derivation and does not grant wagering authority.
Verified schedule rest days feed the existing NFL-PRO context coefficient; bye and
short-week context are derived separately. Travel and injury effects are not
invented or represented as integrated. See verified-schedule-context.md.

`node scripts/prepare-nfl-verified-packet.mjs publication.json schedule.json YYYY-MM-DD new-output.json [previous-packet.json]`
prepares a local output only, refusing overwrites. A separately admitted conditional
writer must publish it. The producer/gateway must be enabled with exact budget
jobs and source hash/ETag receipts before any production acquisition or write.
The paused legacy workflow stays paused. Merging this change alone does not
activate the collector or establish live coverage. All public outputs remain
research-only, not calibrated forecasts or wagering recommendations.
