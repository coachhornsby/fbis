# Public visibility preparation (operator runbook)

This document records the cleanup branch work for temporarily making `coachhornsby/fbis` public so GitHub-hosted Actions avoid private-repository minute billing.

**Do not change repository visibility until the owner approves the final exposure report.**

## License

No open-source license is selected in this pass. Default GitHub copyright (all rights reserved) remains unless the owner explicitly chooses a license.

## What stays private (server-side)

- GitHub Actions secret **values**
- Cloudflare Pages secret **values**
- D1 production rows (strategy tickets, snapshots, executed bets)
- R2 archive objects

## What was scrubbed from the public tree

- Hardcoded odds-API fallbacks removed from workflow YAML (require GitHub secrets)
- `strategy.json` stubbed (no tickets)
- Cohort JSON/SQL replaced with synthetic fixtures
- In-code seed specs replaced with synthetic fixtures; production seed identity is D1-authoritative

## History rewrite

Credential and real wager blobs may still exist in git history. A `git filter-repo` (or equivalent) rewrite of all refs is required before public visibility. Force-push targets and consequences are listed in the final exposure report — do not force-push until the owner approves.

## Required owner actions before going public

1. Rotate SharpAPI and TheRundown keys that previously appeared as workflow fallbacks.
2. Enable secret scanning + push protection.
3. Approve or reject intentional public exposure of model coefficients / CFBD audit artifacts.
4. Approve history rewrite + force-update of listed refs.
5. Explicitly approve the visibility change command.
