# Inactive NFL snapshot write plan

The writer is an internal function only. No route, credentials, binding, budget policy, scheduler or production data has been changed. Its presence does not authorize invocation.

## Separate bounded operations

1. Inspect the fixed NFL key using NFL_SNAPSHOT_INSPECTION_JOB: one read, 8 MiB, inspectionAttempts=1.
2. Publish approved exact bytes using NFL_SNAPSHOT_WRITE_JOB: one HEAD and one conditional PUT, 8 MiB body, snapshotWriteAttempts=1.
3. Verify using NFL_SNAPSHOT_VERIFY_JOB: one read, 8 MiB, snapshotVerifyAttempts=1. Compare returned SHA-256 against the approved input hash; a successful reread alone is not proof of intended publication.

Each operation has a distinct fixed reservation ID and per-period one-attempt allowance. Each requires separately approved coordinator overhead and 100ms CPU declarations. Aggregate policy must cover three R2 reads, one R2 write, up to 24 MiB, three coordinator calls/six storage gets/six storage puts, and all three attempt counters. These are code ceilings, not a cost quote or activated allocation. Preserve the account's existing internal stop and owner budget. No D1, lists, provider requests, retries or deletes are permitted.

Use a distinct, stable, protected durable launcher marker for each specifically approved operation. Never reuse a different path to retry the same operation. A missing initial snapshot is an observed absence, not a reason to bypass admission. If a write is uncertain, do not retry: consume the separately admitted verification operation and compare exact hashes.

## Writer preconditions and race safety

Input is limited to 8 MiB, current NFL season, all 32 canonical teams/player groups and required finite advanced fields. It requires explicit ISO builtAt (createdAt fallback is intentionally rejected), fresh source observation, nonfuture data-through, exact SHA-256, NFL source identity, and concrete season-matched completed game IDs.

Receipt shape checks cannot prove authenticity or source completeness. The approved private gateway must receive independently reviewed source evidence and the exact expected predecessor ETag. Null ETag explicitly means approved create-if-absent. HEAD must agree with that predecessor; an existing object requires known older builtAt metadata. PUT uses atomic etagMatches or etagDoesNotMatch `*`. Races return conflict without retry. An existing legacy object lacking build metadata requires a separately reviewed migration plan; it is not silently overwritten.

## Source completeness established for gathered input

Official nfldata schedule https://github.com/nflverse/nfldata/raw/refs/heads/master/data/games.csv was fetched once (HTTP 200, 2,189,016 bytes) on Nov 8 at 23:40 UTC. It was compared by game ID with the last row of each REG game in the previously gathered PBP. All 130 observed games end with explicit END GAME; this matches 260 current team-week records.

Weeks 1–8 have every scheduled game represented. Week 9 has 9 of 15 scheduled games, so completedWeek is 8, not 9. Missing week-9 games: ARI–SEA, BUF–MIN, GB–NE, HOU–LAC, LV–SF and TB–CHI. This verification covers PBP/team game presence, not NGS or snap-count family timeliness. Source family timestamps remain separate, with snaps last updated Nov 6. A max game date does not provide exact completion time; the reviewed receipt must state a justified conservative data-through bound rather than invent an exact final timestamp.

## Exact deployment prerequisites

- Private NFL worker only: no public routes/workers.dev/previews/schedules. Attach the intended archive bucket as R2_ARCHIVE and existing AccountBudget service as FBIS_ACCOUNT_BUDGET, with the verified account identifier. Never repurpose CBB bindings.
- Reuse an already authorized protected ORCH credential through approved provisioning. Creating/expanding persistent access or a new credential is a separate permission decision; this work did neither.
- Use a verified existing private operator gateway. No live gateway has been selected or configured. Writer/verification routes must not be exposed by casually extending the inspection HTTP route.
- Approve exact snapshot hash, key, predecessor and independent source receipt before any write. Independently review deployment config, request-size limits and the three per-operation grants.
- Confirm output only affects future NFL games and preserves existing pregame records. Consumer/model promotion remains separately gated; writing a snapshot does not establish model influence, calibration or wager authority.

## Coordinated envelope contract and existing gateway

Publication now stores a single atomic `nfl-feature-publication-v1` envelope containing the exact snapshotText and full independently reviewed receipt (including all ten official source observations and completed game IDs). This prevents a receipt/data mismatch from separate-object publication. `snapshotSha256` identifies original snapshot bytes; `storedSha256` identifies the entire stored envelope. Post-write verification must compare storedSha256. Total stored envelope remains limited to 8 MiB. The legacy loader intentionally rejects this new shape; live publication is blocked until the coordinated gated consumer is deployed and independently reviewed.

Non-mutating Cloudflare control-plane inspection confirmed the existing fb is-orchestrator (actual script ID `fbis-orchestrator`) already has R2_ARCHIVE pointing to fbis-archive, the AccountBudget binding and an ORCH_CONTROL_TOKEN secret. Secret values were not retrieved. It currently runs a 10ms CPU limit. The live account-budget policy has 18 jobs and no NFL jobs; its existing allocation expires Nov 26. None of these settings was changed.

The staged existing-gateway route handles only `/api/nfl/features/inspect`, `/api/nfl/features/publish`, `/api/nfl/features/verify`, before broader auth/runtime work. It is disabled absent FBIS_NFL_FEATURE_OPERATIONS_ENABLED=true. It uses the existing control token only, never OAuth/JWKS fallback, requires declared 100ms reviewed runtime, accepts empty reads or bounded 9 MiB/5-second publication input, and requires exact full-envelope hash pinned in FBIS_NFL_APPROVED_PUBLICATION_SHA256 before write admission. Publishing receipt changes needs a new exact pinned approval. Enabling routes, changing CPU limits or modifying budget policy remains a separately authorized deployment step; no new gateway credential or binding is necessary for this existing-gateway option.

The gateway routes alone do not certify source correctness, runtime CPU performance or model influence. The independently developed consumer must validate the envelope, sources, full season schedule, fixture identity and completed prior games, then apply appropriate NFL game/player projection paths without changing college projections.
