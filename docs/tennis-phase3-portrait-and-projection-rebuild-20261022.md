# Tennis recovery — portrait Phase 3 and independent projection rebuild

Checkpoint: 2026-10-22. Scope: existing `coachhornsby/fbis` only. No change to PURE champion, wagering authority, or production source routing.

## A. Portrait library: locked cohort

- Roster: `tennis-elo-private-20261019-1074`, ATP 559 and WTA 515.
- Phase 1 roster and access restrictions: migration 0119; source identities: migration 0120.
- Official headshot candidates are **not** verified image-use rights. ATP URL case correction in PR #1539 must land and candidates must pass source checks. WTA templates require source checks.
- The project is publicly reachable until independently proven otherwise. Restricted official images must not be fetched/copied under an unverified private-use claim.
- The existing `tennis_player_portraits` table already stores asset keys for licensed Commons images. Do not reclassify them as ATP/WTA official portraits.
- Phase 3 operator evidence: authenticated `GET /api/tennis-private-portrait-phase3?limit=100` reports full tour aggregates, sample missing players, private asset rows, rights/access gate, and public-scope violations. These are **database records, not confirmed R2 bytes**.

### Import release prerequisites

1. Confirm ATP/WTA rights documentation explicitly permits local private image copies, storage, defined users, this betting-research context, and R2 hosting. Store secure references; do not place permission documents or secrets in public GitHub.
2. Verify access controls on every UI/API/preview/custom-domain/R2 delivery route. A private repository alone does not make Cloudflare Pages private.
3. Resolve official identities and verify URLs without guessing missing image references. Keep source/evidence timestamps.
4. Only after (1)-(3), implement a bounded authenticated importer. It must verify canonical ID/tour, URL host/path, response mime and max bytes, image signatures and checksum, and immutable private R2 key; write registry atomically or reconcile orphan bytes, never publish publicly.
5. Record `PRIVATE_ONLY`, `public_display_allowed=0`, rights reference, checksum, source URL, import time, and verified object existence.
6. Produce four cohort reports: canonical identities, verified official URLs, confirmed imports with R2 HEAD/checksum metadata, and all missing players by tour.

No premature `APPROVED` transition. The phase-2 `private_image_imported` field is explicitly CHECK-constrained to 0; do not mutate it or bypass its triggers. Build a separate auditable import ledger through a forward-only migration once rights are documented.

## B. Independent Tennis projection rebuild (parallel)

Existing inference code: `functions/lib/tennisProjectionPipeline.js`; coverage API: `/api/tennis-projection-coverage`; snapshot store: `tennis_v2_research_decisions`.

### Gates and execution sequence

1. Read production SHA, official fixture inventory, `PURE_FIXTURE` decisions, normalized market inventory, and D1 binding state separately; distinguish verified from unknown.
2. Classify every missing projection by deterministic block reason: invalid event proof, ambiguous player join, surface/profile missing, stale or post-match inputs, unverified match format, rejected simulation, or failed persistence.
3. Build independent source-backed prematch player features per tour and surface. Current Tennis Abstract Elo is research-only; preserve provenance/cutoffs and don't silently promote Elo research cards to PURE.
4. Evaluate existing v2 champion vs v1.1 and any bounded challenger on time-ordered historical match splits; prevent future source data leakage, include opponent quality, serve/return features, sample uncertainty, and ATP/WTA and surface cohorts.
5. Produce and persist independent match win probabilities for eligible official fixtures **before** attaching Polymarket/Kalshi quotes. Missing prerequisites stay blocked, never filled by implied market probabilities.
6. Only then calculate fair American odds, model-market gaps, calibration, log loss/Brier, prospective CLV, ROI, drawdown, and cohort sufficiency where source evidence permits.
7. Add a CI and production audit reporting total eligible fixtures, independently projected, stale, blocked by reason, and orphan/duplicate snapshots. Route production promotion through the existing FBIS qualification gates, not the portrait job.

## Completion criteria

Portraits: exact 1,074 locked players, complete identity reconciliation, verified official URL coverage >=90% (967+), authorized R2 objects confirmed individually, no public official portraits, by-tour full missing report. If rights never allow private copies, report the hard blocker rather than manufacture 100% imports.

Projections: every *eligible* independently sourced upcoming ATP/WTA singles match receives an immutable premarket PURE prediction, or a documented block; source and snapshot time are auditable, historical and prospective validation reported, wagering authority unchanged until formal qualification.
