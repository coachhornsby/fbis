# Security policy

## Reporting

If you discover a vulnerability or exposed credential in this repository, **do not open a public issue with secret values**. Contact the repository owner privately and rotate any affected credentials immediately.

## Secrets

- **GitHub Actions secrets** hold CI/deploy credentials and API keys used by workflows.
- **Cloudflare Pages secrets** hold runtime API keys for Functions.
- **Cloudflare D1 / R2** hold production tickets, snapshots, and archives — not this git tree.
- Never commit `.env`, `.dev.vars`, private keys, service-account JSON, or raw API tokens.
- Never pass secret values through `workflow_dispatch` string inputs (they appear in Actions logs).

## Public / private boundary

This repository may be made temporarily public so GitHub-hosted Actions can run without private-repository minutes. When public:

- Treat every reachable git object, PR, comment, Action log, and artifact as world-readable.
- Operator wager history and production database exports must not live in git.
- Model source and methodology may intentionally be public; that is an owner decision, not an accident.

## Recommended GitHub settings (owner)

1. Enable **secret scanning** and **push protection**.
2. Protect `main`: require PR reviews, require status checks (`TEST / BUILD`), disallow force-push except during an explicit history-rewrite window.
3. Restrict who can approve workflow runs from forks.
4. Rotate any key that ever appeared in git history before or immediately after a public visibility change.

## Actions hardening

Workflows should use least-privilege `permissions`, concurrency groups, timeouts, and artifact retention limits. Untrusted pull requests must not receive privileged secrets or deploy credentials.
