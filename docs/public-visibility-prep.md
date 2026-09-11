# Public visibility preparation (operator runbook)

**Do not change repository visibility until the owner approves the final exposure report in the PR / agent summary.**

Repo target: `coachhornsby/fbis` (currently **private**).
Goal: temporary public visibility so GitHub-hosted Actions avoid private-repository minutes, without changing production model/D1/schedule behavior.

## License

No open-source license is selected in this pass. Default GitHub copyright (all rights reserved) remains unless the owner explicitly chooses a license.

## What stays private (server-side)

- GitHub Actions secret **values**
- Cloudflare Pages secret **values**
- D1 production rows (strategy tickets, snapshots, executed bets)
- R2 archive objects

## Tip scrub completed on this branch

- Hardcoded SharpAPI / TheRundown fallbacks removed from workflow YAML (require GitHub secrets only)
- `strategy.json` stubbed (empty tickets; D1-authoritative note)
- Cohort JSON/SQL replaced with synthetic fixtures (no real clubs / slips)
- In-code seed specs replaced with synthetic fixtures; `canonicalSeedTickets()` prefers D1 when seed rows exist
- Hardened `.gitignore`, `.env.example`, `SECURITY.md`, Dependabot
- Actions: least-privilege `permissions`, concurrency, path-ignore for docs-only, pinned action minors, artifact retention

## History rewrite (required before visibility change — not applied to remotes)

Offline `git filter-repo --replace-text` on a mirror scrubbed the historical SharpAPI `sk_live_…` token (fingerprint `13061cd0291c`) from workflow blobs. Documentation-only `sk_live_…` mentions remain.

**Not yet force-pushed.** Owner must approve rewrite of all refs that still contain:

1. Historical `ci.yml` blobs with embedded API key fallbacks
2. Historical `strategy.json` / cohort files with real operator picks
3. Historical `functions/lib/strategy.js` real seed specs
4. Historical CFB calibration artifacts under `data/cfbd/calibration/` (if any remain reachable)

## Required owner actions before going public

1. **Rotate** SharpAPI and TheRundown keys that previously appeared as workflow fallbacks (treat as compromised).
2. Enable GitHub **secret scanning** + **push protection**.
3. Approve or reject intentional public exposure of model coefficients / CFBD audit artifacts / methodology docs.
4. Approve history rewrite + force-update of listed refs (or delete obsolete branches after confirming merge).
5. Explicitly approve the visibility change (`gh repo edit coachhornsby/fbis --visibility public` or GitHub UI).
