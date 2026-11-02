# FBIS CBB availability evidence and private release gate

Implemented the missing private availability intake and connected it to fixture-level release readiness. This is offline engineering; no model coefficient, live route or collector changes.

## Availability contract

`cbbAvailability` accepts exact ESPN player IDs from the saved current roster and source-linked official team evidence. Every accepted record binds to the complete fixture key and canonical team. Source URLs must use HTTPS, have no embedded credentials, and match an explicitly reviewed hostname allowlist. Both publication and retrieval times are required, ordered, before tip, not future-dated and within six hours of evaluation.

Allowed source statuses: ACTIVE, OUT, DOUBTFUL, QUESTIONABLE. No record means UNKNOWN. Roster membership never means healthy or active. One covered player does not establish team coverage. Missing opponent rosters remain INCOMPLETE_ROSTER. Conflicting accepted statuses remain CONFLICT rather than silently selecting a preferred report. Coverage completion does not calculate a player-impact adjustment or approve a wager. The operator must verify source authenticity and wording; an allowlisted hostname alone cannot verify a submitted claim.

Private evidence-file shape:

```json
{
  "officialHosts": ["reviewed-team-domain.example"],
  "records": [{
    "eventId": "exact ESPN event ID",
    "fixtureKey": "event|date|start|home ESPN ID|away ESPN ID|neutral boolean",
    "teamId": "cbb-123",
    "playerId": "exact ESPN athlete ID",
    "status": "OUT",
    "sourceClass": "OFFICIAL_TEAM",
    "sourceUrl": "https://reviewed-team-domain.example/news/official-source",
    "publishedAt": "2026-11-02T15:00:00Z",
    "observedAt": "2026-11-02T16:00:00Z"
  }]
}
```

The example is a schema illustration, not real availability evidence. A new source host requires review before inclusion. No automatic source scraping or name-only player matching.

## Release readiness

`buildCbbReleaseReadiness` joins current schedule identities, the original private projection packet, historical market observations and availability evidence. It rejects duplicate event records and preserves source timestamps. Projection expiry, reschedules, started games, missing primary/CBBD/native evidence, classification holds and incomplete availability remain explicit reasons. The aggregate report evaluates a full side-and-total evidence package; it does not add native-total requirements to the frozen side model or change existing qualification rules.

A market observation must bind to the full fixture key, carry a complete capture, its own actual rules/contract/price/size evidence, a caller-established current status, and a timestamp no older than five minutes. Historical intake records never pass by changing the report generation time. Even hypothetical complete evidence receives EVIDENCE_REVIEW_REQUIRED, never an automatic production deployment or wager approval. This is a private operations diagnostic, not an execution engine or a claim of a hard account spending cap.

## November 2 snapshot

Two bounded public ESPN scoreboard requests captured at 16:10:28–16:10:31 UTC (10:10 AM Central) yielded a deduplicated 182-event Central-date slate. Both raw responses stayed below the requested 300-event cap. Original capture times, server Date headers and SHA-256 hashes are retained. No provider credential or D1 query was used.

At the explicit evaluation cutoff 16:10:32 UTC:

- 177 fixtures were pregame; five were already live/final or at/past their scheduled start.
- All 182 failed the expired-projection, missing current CBBD confirmation, missing native total and current complete market-evidence checks.
- 119 fixtures had saved rosters on both sides, with availability UNKNOWN. Another 63 lacked a complete two-team roster (principally non-D1 opponents); roster absence does not imply a healthy lineup.
- Seven older projection fixture keys did not match the current corrected schedule representation. No silent rebinding or forecast carry-forward.
- One West Florida classification hold remains. It is a fixture-specific hold, not a reason to withhold unrelated verified schedule/score pages.
- No new availability records had arrived from Grok. No injuries, starters or minutes were invented.

This is a timestamped snapshot, not a claim that these counts remain current. The operating schedule/score site remains separate from prediction readiness. Existing licensed input captures are still expired; they were not refreshed by this phase.

## Reproduce

Place the private source files under `artifacts/cbb-release-readiness/`: dated ESPN JSONs and `scoreboard-captures.json`. Keep prior verified projection, roster and market research outputs in their existing private artifact directories. Run:

```sh
node scripts/build-cbb-release-readiness.mjs 2026-11-02T16:10:32Z
```

For a later newly captured slate use its real evaluation UTC cutoff; captures must be within five minutes. An optional third argument supplies the private reviewed availability JSON. A stale capture fails and is never relabeled current. Output is `private-readiness.json` plus `receipt.json`, ignored by Git and excluded from the public build. Source hash checks run before parsing; conflicting duplicate fixture identities stop generation.

Validation: eight new Node tests cover unknown/partial/conflicting availability, roster gaps, source/identity/time rejection, expired projections, old markets, started/rescheduled fixtures, duplicate projection IDs and absence of automatic authority. Run with the existing projection, official-fixture, frozen CBB-PRO and static-board suites.

## Grok work

Supply the schema above as private source-linked evidence for upcoming November 2 fixtures. Prioritize official starters and material OUT/DOUBTFUL/QUESTIONABLE news with IDs and timestamps; do not mark an entire roster ACTIVE because no injuries were listed. Keep unsupported players UNKNOWN. Finish official-bio checks for the 20 same-team leads separately. Upload only private evidence and post the file link in the handoff. No new recurring jobs or production changes are part of this research assignment.
