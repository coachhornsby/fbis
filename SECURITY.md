# Security policy

This repository is **public**. Treat every commit on every reachable ref as world-readable. Never put secret values in git, issues, PRs, chat, workflow inputs, or client bundles.

## Reporting

If you discover a vulnerability or exposed credential, contact the repository owner privately and rotate any affected credentials immediately. Do not paste secret values into issues, PRs, chat, or workflow inputs.

See also: `docs/public-visibility-prep.md` for the public-visibility checklist.

## Secrets

- **GitHub Actions secrets** hold CI/deploy credentials and API keys used by workflows.
- **Cloudflare Pages secrets** hold runtime API keys for Functions.
- **Cloudflare D1 / R2** hold production tickets, snapshots, and archives — not this git tree.
- Never commit `.env`, `.dev.vars`, private keys, service-account JSON, or raw API tokens.
- Never pass secret values through `workflow_dispatch` string inputs (they appear in Actions logs).

## Odds provider pool

Production market collection uses a provider pool (fail closed when no valid market data):

1. **Parlay** (preferred primary)
2. **TheOdds API**
3. **SharpAPI** (intentional production fallback)
4. **TheRundown** (intentional production fallback)

`SHARPAPI_API_KEY`, `THERUNDOWN_API_KEY`, and `THEODDS_API_KEY` are optional only in the fail-safe sense: FBIS must not crash, overwrite Cloudflare secrets with empty values, or fabricate odds when a key is absent, exhausted, or rate-limited. When valid credentials are installed, SharpAPI and TheRundown are **active production fallbacks** used for market coverage — not dormant integrations.

Historical SharpAPI / TheRundown values that once appeared in workflow YAML remain compromised. Revoke/rotate them at each provider and install **only newly rotated** keys into GitHub Actions and Cloudflare Pages secrets. Never embed fallbacks in git. Never accept raw secret values via `workflow_dispatch` inputs.

## Recommended GitHub settings (owner)

1. Enable **secret scanning** and **push protection**.
2. Protect `main`: require PR reviews, require status checks (`TEST / BUILD`), disallow force-push.
3. Restrict who can approve workflow runs from forks.
4. Rotate any key that ever appeared in git history.

## Actions hardening

Workflows should use least-privilege `permissions`, concurrency groups, timeouts, and artifact retention limits. Untrusted pull requests must not receive privileged secrets or deploy credentials.
