# Security policy

## Reporting

If you discover a vulnerability or exposed credential, contact the repository owner privately and rotate any affected credentials immediately. Do not paste secret values into issues, PRs, chat, or workflow inputs.

## Secrets

- **GitHub Actions secrets** hold CI/deploy credentials and API keys used by workflows.
- **Cloudflare Pages secrets** hold runtime API keys for Functions.
- **Cloudflare D1 / R2** hold production tickets, snapshots, and archives — not this git tree.
- Never commit `.env`, `.dev.vars`, private keys, service-account JSON, or raw API tokens.
- Never pass secret values through `workflow_dispatch` string inputs (they appear in Actions logs).

## Soft-book backups

`SHARPAPI_API_KEY` and `THERUNDOWN_API_KEY` are **optional**. Collect/harvest continue without them. Historical values that once appeared in workflow YAML must be treated as compromised — install **newly rotated** keys only, and never embed fallbacks in git.

## Recommended GitHub settings (owner)

1. Enable **secret scanning** and **push protection**.
2. Protect `main`: require PR reviews, require status checks (`TEST / BUILD`), disallow force-push.
3. Restrict who can approve workflow runs from forks.
4. Rotate any key that ever appeared in git history.

## Actions hardening

Workflows should use least-privilege `permissions`, concurrency groups, timeouts, and artifact retention limits. Untrusted pull requests must not receive privileged secrets or deploy credentials.
