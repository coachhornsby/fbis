# Tennis Lyrid → FBIS Authority Migration

## Authority decision
FBIS is the authoritative repository for the migrated Tennis player-index subsystem as of this branch.

Source repository: `dezzeyraglin-sudo/Lyrid`
Source commit: `56b46261f19581aef130075ac52045d99d42315d`
Destination repository: `coachhornsby/fbis`

Lyrid is now legacy/reference-only for this subsystem. Do not independently evolve both copies.

## Migrated scope
Core historical feed, feature builder, Elo/anchor/projector, live augmentation, cold start, match read,
Tennis API handlers/adapters, research logging/backtest helpers, smoke utilities, and handoff documentation.

The legacy `tennis_serve_index.json` was deliberately NOT promoted into FBIS because its Challenger
coverage is known to be incomplete. FBIS must rebuild the index only after the source-class integrity
gates pass.

## Verified historical defect
The legacy builder accepted a mirror when aggregate successful downloads were >=3, mixing ATP Tour
and Challenger files in one count. The primary mirror has valid ATP Tour data but zero-byte Challenger
files for 2021-2025, so the build could silently succeed without recent Challenger history.

## 2026 status at migration
The legacy Lyrid builder stopped at 2025, so its historical index did not ingest 2026 ATP/Challenger data.
External technical sources currently expose non-empty 2026 ATP Tour records, but recent Challenger
GitHub archive files remain zero-byte. The user has confirmed direct rights clearance from Jeff Sackmann
for FBIS permanent economic use of Sackmann data. That clearance applies to Sackmann-origin data only;
independently licensed reconstructions remain governed by their own licenses.

## Governance
- betting posture remains `bet:false`
- no betting tier, threshold, bankroll, qualification, or wager-authority promotion
- source availability does not imply economic-use authority
- insufficient player history/live evidence must return NO VALID PROJECTION

## Rights update — 2026-10-07
The user explicitly confirmed that FBIS has rights clearance from Jeff Sackmann. Treat verified
Sackmann-origin ATP/WTA/Challenger data as rights-cleared for permanent FBIS economic use, subject to
normal provenance, completeness, PIT, identity, and quality gates. Do not extend this clearance to
third-party datasets merely because they reproduce or transform Sackmann-shaped data.
