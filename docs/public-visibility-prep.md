# Public visibility — operator status

**Repository visibility:** PUBLIC (`coachhornsby/fbis`).

This document tracks what was already done for a safe tip, and what the owner must still finish after the visibility change.

## Already true on current `main` tip

- No live API tokens in tracked tip files (Actions workflows require GitHub secrets).
- `.env` / `.dev.vars` ignored; `.env.example` is names-only.
- `SECURITY.md` documents secret handling and recommended GitHub settings.
- Cohort / strategy tip fixtures are synthetic; D1 is authoritative for production tickets.
- Action/Apify remains shadow-only: not in `ODDS_PROVIDER_ORDER`, `canQualify=false`, `canAuthorizeWager=false`.

## Still owner-gated (not done by agents)

1. **Rotate compromised provider keys** that ever appeared in git history (SharpAPI / TheRundown historical workflow fallbacks). Install **new** values only in GitHub Actions + Cloudflare Pages secrets.
2. **Rotate any Apify token** previously pasted into chat; install only via secret storage.
3. Enable GitHub **secret scanning** + **push protection**.
4. Protect `main` (required checks, no force-push for normal contributors).
5. Decide whether model/calibration artifacts under `data/` remain public (IP exposure).
6. **History rewrite (optional but recommended):** historical blobs may still contain old keys / real tickets. Rewriting requires an explicit owner-approved force-update of refs. Agents must not force-push without that approval.
7. Fix GitHub Actions **billing / spending limit** so CI can deploy `main` (payment failure, not a code failure).

## What stays private (server-side)

- GitHub Actions secret **values**
- Cloudflare Pages secret **values**
- D1 production rows and R2 archives

## License

No open-source license is implied by publicity. Default all-rights-reserved unless the owner adds a license.

## Deploy note

Public visibility does **not** by itself clear a failed Actions payment / spending-limit block. Production deploy still requires a successful CI `DEPLOY PRODUCTION` (or authenticated Wrangler) for the intended `main` SHA.
