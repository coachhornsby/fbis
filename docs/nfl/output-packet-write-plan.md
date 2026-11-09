# Inactive conditional NFL output-packet publication

Source snapshot publication alone does not update the cards: their private transport reads `private/nfl/projections/YYYY-MM-DD.json`. The new writer targets exactly the date pinned in the independently approved environment manifest; it cannot write a college/sibling sport key. No activation, policy, credential or production data changes were made.

## Required approval

`FBIS_NFL_PACKET_WRITE_APPROVAL` must contain exact date, packetSha256, sourcePublicationSha256, expectedEtag, expectedPreviousSha256 and expiresAt. Approval expires within ten minutes; expiry is checked before admission, before the read, and immediately before PUT. Null predecessor values explicitly approve create-if-absent. Existing objects require exact ETag and body hash. The approval ties the reviewed pure consumer/preparation output to one artifact; it is not proof of source content by itself. Retain the full source envelope and reviewed source/schedule receipts.

The writer does not rerun inference. Prepare the packet with `prepareVerifiedNflRecoveryPacket`, using the bounded previously inspected packet, then independently review and pin its exact bytes. Packet generation must be within five minutes. Changed/new events must still start more than two minutes in the future at the final pre-write check; otherwise rebuild only appropriate future events under a new explicit plan, not an automatic retry.

## Invariants

- Existing events cannot be removed. Started events preserve their serialized event record and generation time.
- Unchanged future records also keep their generation time; packet expiry cannot be extended or an expired prior packet restamped.
- Candidate and predecessor event IDs are unique strings. At most 32 events are accepted.
- New/changed events must be future NFL-PRO-v1 version v1.2.1 research outputs with matching nflverse source provenance and no wager authority.
- The writer uses a conditional create/update, preserving the reviewed predecessor against races. A conflict or uncertain write is never retried. Network completion before kickoff cannot be guaranteed; the two-minute runway is conservative launch protection, not a remote transaction-time guarantee.

## Independent operation ceilings

Writer job `services/nfl/writeProjectionPacket.mjs`: one R2 GET, one conditional PUT, 512,000-byte maximum predecessor and output, aggregate bytes 1,024,000, nflPacketWriteAttempts=1.

Verifier job `services/nfl/writeProjectionPacket.mjs:verify`: one R2 GET, 512,000 bytes, nflPacketVerifyAttempts=1. It compares actual exact bytes to the approved hash and reports verified only on a match.

Both require separately approved 100ms CPU and coordinator overhead, one coordinator call/two gets/two puts each, no D1/list/delete/provider calls, and independent fixed reservation IDs. Existing budget caps are unchanged. A controlled one-shot launcher is still required for each operation; arbitrary authenticated callers are not permitted to repeatedly incur pre-admission work.

## Inactive gateway integration

Existing disabled NFL gateway adds POST `/api/nfl/projections/publish` with raw prepared packet JSON up to 512,000 bytes, and empty POST `/api/nfl/projections/verify`. Existing ORCH authentication, no auth fallback, runtime declaration and body deadline apply. No separate credential is created, and no routes are enabled by this patch.

## Verification and remaining scope

Unit regressions cover exact-key writes, stale/hash-mismatched approvals, conditional conflicts, frozen/removed/restamped records, expiry extension, mixed-type duplicates, late kickoff, and approval expiry during the predecessor read. Actual local workerd/SQLite admission/R2 testing confirms publish, exact-byte verification and replay refusal.

The coordinated consumer now embeds sanitized held player estimates under each event’s nflPlayerResearch. Scores and player rows share one conditional write, exact approval hash and frozen-event protection. The existing public summary/card transports and displays only whitelisted derived estimates with HOLD/BLOCKED status. Publication approval must cover these derived rows as well as scores; no extra storage key or provider payload is introduced. No production publication or calibration/wager authority is established by offline tests.

A separate predecessor inspector is also provided: `services/nfl/writeProjectionPacket.mjs:inspect` uses one GET capped at 512,000 bytes and nflPacketInspectAttempts=1, returning exact body/hash/ETag or confirmed absence. The date is pinned in FBIS_NFL_PACKET_INSPECTION_DATE; clients cannot select arbitrary paths. Its disabled gateway path is `/api/nfl/projections/inspect`. It is required before preparation when a previous packet exists or its existence is unknown. Including inspect, write and verify, reserve three reads, one write, up to 2,048,000 bytes and three independently bounded coordinator invocations. No storage lists or recovery scans are used.

## Combined validation

Player transport commit 4b10a66 was integrated as 1200742. Independent composition review found no writer bypass: the approved hash and frozen JSON comparison include nested player estimates. Tests verify atomic score/player publication and reject any started-player mutation. Frontend production build passes with existing chunk-size warnings.

Final combined regression: 83 tests passed, including real Worker/SQLite/R2, conditional storage, consumer, public summary and score/player freeze checks. Real gathered-data audit at 2026-11-09T00:11:52Z applied to eight future games, carried 357 held player rows and changed 121 player estimates relative to the pre-enrichment baseline. Seven other upcoming fixtures remained unchanged because prior-team completed games were absent. Prepared date packets were Nov 8, Nov 9, Nov 12 and Nov 15, each under 38 KiB. This proves offline propagation, not accuracy or live publication.

Current code intentionally allows one output date per budget period via fixed IDs and single-attempt counters. Publishing all four date packets requires a new explicitly bounded multi-date reservation plan, not altered marker paths or randomized IDs. A single-date pilot can use the existing reviewed scope. Neither path is activated here.

## Current-main integration

The writer is pinned to corrected NFL-PRO v1.2.1. Earlier candidate hashes are invalid; regenerate from the corrected consumer and freeze the exact final bytes before publication.
