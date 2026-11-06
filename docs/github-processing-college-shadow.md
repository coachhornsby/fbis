# FBIS GitHub processing migration: college shadow pilot

This change begins a **GitHub Actions processing path** for CFB/CBBD without invoking Cloudflare.
It is **manual-only**; no cron, no paid collector, no DB write, no EdgeFinder publication and no replacement of existing production authority.

## Run order

1. Review and merge this pull request after offline tests pass.
2. Add `CFBD_CBBD_KEY` in repository **Actions secrets** using GitHub's secure secrets UI. The secret is **not** supplied in this code or artifacts.
3. First run **FBIS GitHub College Source Shadow** with `network_capture=false` to confirm dry-run receipt.
4. Run with `network_capture=true` only after confirming entitlement and requested filters. This performs **at most two requests**, one to `CFBD /games` for the selected year/week and one to `CBBD /games` for season ending year and a selected team.
5. Download and validate receipts: count, SHA-256, returned record shape, team/year constraints, observed time, missing fields and source license. Incomplete jobs fail closed.

## Hard limits and interpretation

- 12-second request timeout; 2 MB per response; fewer than 250 records per provider.
- Historical odds and completed box scores are research evidence, **not** automatically current market quotes or pregame features.
- Never promote backtests, provisional ratings, provider returns or scraped data into approved wagers without independent frozen model, PIT evidence, settlement and qualification gates.
- No raw provider key, request header or authentication-bearing URL in artifacts. GitHub's public repository has no protected evidence storage guarantees; Actions artifacts have scoped access and only 7-day retention here.
- The workflow does not yet archive to Google Drive or serve an API to EdgeFinder Labs. Those follow after captured source parity is established.
- Avoid running old Cloudflare-backed workflows as part of this pilot.

## Acceptance criteria for phase 1

- Offline contract tests pass.
- Dry-run artifact generated without provider calls.
- Provider entitlement checked for each endpoint.
- Two bounded live provider responses succeed with correct season/game identity and complete result sets.
- Snapshot checksums and timestamps retained and independently verified.
- Cloudflare monthly D1 write/read impact attributable to this workflow = zero.
