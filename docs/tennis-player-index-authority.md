# Tennis player-index authority

## Authority decision

As of this migration, `coachhornsby/fbis` is the authoritative source repository for the Lyrid-origin Tennis player-index subsystem.

Source repository: `dezzeyraglin-sudo/Lyrid`
Source commit: `56b46261f19581aef130075ac52045d99d42315d`
Migration branch: `feat/tennis-lyrid-authoritative-migration`

The source account available to FBIS has read-only access to Lyrid, so Lyrid is now legacy/reference-only for this subsystem. New Tennis player-index changes belong in FBIS only.

## Migrated paths

- `tennis/*` runtime, feature, Elo, projection, live, cold-start, and research modules
- `api/tennis/*` Lyrid-compatible API handlers
- `build_tennis_index.sh`

The stale Lyrid `tennis/tennis_serve_index.json` was intentionally not adopted as authoritative data because its build path excluded 2026 and could silently omit Challenger years.

## Deployment implication

FBIS uses Cloudflare-oriented deployment infrastructure, while the migrated `api/tennis/*` handlers originated in a Vercel-style runtime. They are retained as the canonical Tennis subsystem implementation during migration, but production routing must be integrated with FBIS deployment conventions before treating those endpoints as production-cutover routes.

Source authority and deployment authority are separate gates.

## Historical-source authority

Sackmann-derived mirrors remain research/shadow inputs unless rights permit permanent economic use.

- Alexandra mirror: research source; rights pending
- michaelbruen mirror: fallback research source; rights pending
- Aneeshers Sackmann archive: CC BY-NC-SA 4.0; research-only fallback, never automatic production/economic authority

The builder therefore distinguishes `production` and explicit `research` modes.

## 2026 status at migration

The previous Lyrid builder stopped at 2025, so 2026 was not persisted into the historical player index.

Upstream source checks on 2026-10-07 found:

- ATP Tour 2026: 1,169 rows, 88.8% usable serve-stat coverage, through 2026-04-22 in the Alexandra mirror.
- ATP qual/Challenger 2026: 4,519 rows, 99.8% usable serve-stat coverage, through 2026-04-28 in the Alexandra mirror.
- Sackmann archival snapshot qual/Challenger 2026: 5,745 rows, 99.8% usable serve-stat coverage, through 2026-06-01.

These are partial/stale relative to 2026-10-07. The repaired builder includes the current year but reports freshness warnings rather than pretending the current-year archive is complete.

## Governance

This migration does not promote any betting tier, threshold, bankroll rule, qualification status, or wager authority.

Player-data completeness remains infrastructure. Betting authority still requires independent OOS predictive lift, calibration, prospective shadow evidence, CLV, and realistic economics.
