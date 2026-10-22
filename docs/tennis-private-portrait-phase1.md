# FBIS Tennis — Private official portrait Phase 1

## Cohort source and version lock
- Exactly **559 ATP** and **515 WTA** players; **1,074 total**.
- Source: validated **2026-10-19 Tennis Abstract Elo report** for each tour.
- Frozen cohort ID: `tennis-elo-private-20261019-1074`.
- Source hashes are pinned in migration `0119_tennis_private_portrait_phase1.sql`. A later ratings refresh **cannot change this cohort implicitly**.
- A canonical `fbis_player_id` is assigned only on an unambiguous exact normalized-name/tour match. Unmatched and ambiguous identities remain in the locked cohort but cannot be used for portrait imports before manual reconciliation.

## Rights and access

The project owner reports that ATP and WTA conditionally permit using their headshots **only when the project is private**. This report is **not itself the grant documentation**, and is stored as `USER_REPORTED_PRIVATE_PROJECT_USE_ONLY`.

As of this phase:
- The GitHub repository `coachhornsby/fbis` is **public**, and Cloudflare Pages does not have an independently verified access restriction.
- Both official portrait rights policy records begin **BLOCKED**, `PRIVATE_ONLY`, `public_display_allowed=0`.
- Rights document/evidence reference is **NULL / required**; nobody should invent a grant identifier or approve images on the basis of verbal reports alone.
- No official ATP/WTA headshots have been copied into R2 or enabled for public serving by this migration.
- Database triggers reject a restricted ATP/WTA portrait if `display_scope` is not `PRIVATE_ONLY`, and reject `approval_status='APPROVED'` until documented rights and verified private access are registered for the target cohort.
- The existing public portrait endpoint serves only separately approved `PUBLIC_WEB` assets, such as appropriately licensed Commons photos. It **does not serve** private official ATP/WTA assets. Preserve distinct license scopes.

## Required checks before Phase 2

1. Record the actual ATP/WTA permission instrument, including permitted uses, users, redistribution, retention, revocation, attribution, and whether Cloudflare Pages behind access control qualifies as a private project. Record its **secured reference**, not the license document itself, in `rights_evidence_ref`.
2. Change GitHub visibility to **private** and verify access control over the actual Cloudflare Pages deployment, including custom domains, preview aliases, image delivery, R2 public URLs, cached copies, and any API routes. Merely making GitHub private does **not** make Pages private.
3. Only after access and legal evidence are confirmed may an operator transition the policy to `DOCUMENTED_PRIVATE_USE`, `VERIFIED_PRIVATE_ACCESS`, and `PRIVATE_IMPORT_ALLOWED`.
4. Reconcile unmapped players by official ATP/WTA player identifiers; never identify athletes from a name-only ambiguous match.
5. Import privately, verify image bytes and canonical tour/player identity, and measure coverage against **the locked 1,074**, not the legacy `tennis_players` table.
6. Never change the `research_only` Elo feed into a calibrated model or wager authority because images/ratings are available.

## Operator verification

`GET /api/tennis-private-portrait-phase1` requires the harvest authentication header. It reports the roster source receipt hashes, both tour totals, canonical identity counts, and whether restricted imports are blocked. It never returns private image bytes or rights documentation.

Both the primary D1 and Tennis shadow D1 should be checked independently before declaring full rollout.
