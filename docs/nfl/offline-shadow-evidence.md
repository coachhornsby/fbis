# Offline NFL advanced shadow evidence

This runner is local research tooling, not an active FBIS board model. No network,
Cloudflare credentials, R2/D1 access, publication, schedules or wagers are used.

Run `node scripts/nfl-shadow-evidence.mjs snapshot.json source-evidence.json slate.json 2026`.
The report goes to stdout; blocked games set exit code 2. Inputs are capped at 8 MiB
for the snapshot, 64 KiB for receipt/slate, and 32 games.

The snapshot uses the existing nflverse-features format. The independently reviewed
source receipt must contain `snapshotSha256` (hash of exact file bytes),
`source: "nflverse"`, `observedAt`, `dataThrough`, and `completedWeek`.
Dates require an explicit timezone. Observation and snapshot build must be within
36 hours. The last completed game's data-through can be older, but must not exceed
the source observation. Each slate row needs `id`, canonical `home` and `away`
team keys, `start`, `requiredCompletedWeek`, and optional boolean `neutralSite`.
The receipt is evidence supplied by an authorized source audit, not generated from
file modification time or invented by this tool. Schema validation cannot establish
truth or completeness of a receipt's claims. Snapshot hashes bind its assertions to
one input, not to an independently authenticated upstream download.

The runner executes the existing NFL-PRO-v1 v1.2 shadow model only after checks.
It strips nonnumeric feature values and never passes prices to the model. Its output
forces `canQualify: false`, `edgeEligible: false`, and `canAuthorizeWager: false`.
Coverage describes actual consumed inputs. Personnel is NOT consumed by this model;
full opponent adjustment is not established. Neither is relabeled as verified.
The runner does not establish calibration or economic performance.

## Current live integration boundary

The bounded board deployment under deploy/board does not import nflVerseFeed.
Current four-sport recovery calls NFL-TEAM-FORM-v0 from ESPN finals. Shipping the
board does not activate this advanced model or deploy legacy NFL API handlers.
Do not restore root Pages functions/bindings merely to ship the snapshot guard.

## Permitted next acquisition design (not implemented or executed)

1. Add a fixed-key, authenticated inspection job for `nfl/features/latest.json`
   to the existing account admission controller. Reserve one R2 Class B read,
   maximum 8 MiB, zero lists, zero writes, zero D1, no provider fanout, no retries.
   Require a fresh valid budget receipt before storage access; preserve $10 ceiling.
2. Check the receipt and operation identity, read only that key, bind content hash
   and metadata in a private local artifact, record actual outcome. An uncertain
   read is not automatically retried. Missing/oversized data fails closed.
3. Independently establish source observation, latest completed week, data-through,
   and both-team coverage from authorized evidence. Do not manufacture a new
   observation from an old snapshot's download time.
4. Run this gate, then compare the shadow with baseline on identical pregame
   evidence. Missing inputs are reported, not backfilled using future data.
5. Source freshness/personnel and out-of-sample validation still block NFL edge
   issuance. Model promotion/publication remains a separate validated action.

Legacy direct R2 endpoints and root API snapshot reads are not admission substitutes.
The existing CFB-only archive inspection scripts are not reused with a changed key.
