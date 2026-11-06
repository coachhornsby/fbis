# FBIS: GitHub read-only Drive archive bridge

The private CBB archive hashes and file IDs are already recorded. This workflow verifies the SAME three archived files using Google Drive's read-only API. It does not create new historical datasets, publish raw provider responses, or change production. GitHub's public repository must never store the private archive contents.

## Required credential and access

GitHub Actions must receive a service-account credential in encrypted repository secret `FBIS_DRIVE_SERVICE_ACCOUNT_JSON`. The service-account email must be granted **Viewer** access to the three exact archives (or their parent folder). The workflow requests only `drive.readonly` scope. Creating a Google service account may require a Google Cloud project; do not create one or activate paid services without cost review.

If the secret or Drive file permissions are absent, the manual job correctly fails closed. Never paste credentials into chat or commit credential JSON to the public repo.

## Execution

1. PRs run only the offline verifier contract tests, never authentication or downloads.
2. After merge, manually run **FBIS private Drive archive readback** with `verify_drive=true`.
3. It downloads three allowlisted archives, verifies the archive SHA-256 and every member against the bundled manifest, then uploads a non-sensitive receipt (7-day retention). Maximum file size 25 MB each; network timeout 35 seconds.
4. Run original existing model modules in the independent `fbis-college-model-shadow-regression.yml` workflow. The baseline/feature join is still required for meaningful historical per-game projection comparison.

## Scope and rules

- Current data freshness **not** proven by archive integrity; November 2 snapshots are historical.
- No Cloudflare binding, D1 calls, paid collectors, cron, live market data, or EdgeFinder publishing.
- No numerical live projection parity until original point-in-time feature snapshots and matching frozen forecasts are supplied.
- No auto-qualification or wager authorization.

Archive SHA-256s were independently verified in an isolated local Drive readback on November 6.
