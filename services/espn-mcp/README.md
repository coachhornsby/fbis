# FBIS ESPN connector

The private `fbis-espn` plugin now connects to `fbis-espn-mcp` rather than the shared source hub. The old shared Worker and its PinnOdds/Torvik connections remain unchanged. The ESPN Worker has no models, wagering logic, storage writes or scheduled handler.

## Release 1.1.0, November 6, 2026

- Portable root plugin and MCP registration; retained compatibility files and original plugin identity, scope and audience.
- ESPN-only tool discovery: scoreboard, summary, paginated team directory and connector status.
- Complete serialized JSON, not a sliced JSON string. The old shared Worker sliced inner content at 52,000 characters and returned failures as unstructured text.
- College schedule queries explicitly request `limit=1000`, FBS group 80 or CBB group 50. Responses expose counts, pagination and upstream bounds. CFB team-directory groups are ignored upstream, so directory coverage is labeled all divisions.
- Scores preserve upstream values. `scoreAvailable=false` identifies pregame zeros. Source statuses, team IDs, event IDs, clock, period and completed state survive normalization.
- Fetch receipt, HTTP Date, Last-Modified, Age and explicit provider update timestamps are separate fields. Missing timestamps stay null.
- Invalid inputs, HTTP failures, timeouts, non-JSON responses, schema errors, mismatched event IDs and excessive upstream bytes fail explicitly.

## Budget

Each upstream call must reserve the `services/espn-mcp/worker.mjs` job in the existing `fbis-account-budget` Durable Object. The certified cap is one GET, 4 MiB of response bytes, no D1 operations, no R2 operations and 100 ms CPU. The reservation costs 3 micro-USD inside the existing account allocation. There are no retries or background polling.

The release added only this job to the existing live certification and policy. It preserved the existing ledger, $7 committed cost reserve, $0.50 cycle allocation, aggregate unit ceilings and $8 application stop, keeping the owner's $10 monthly limit unchanged. These application controls are not a Cloudflare billing hard cap. Policy expiry still fails closed. CPU limits and 1% observability sampling bound operational costs; they do not prevent malicious unauthenticated traffic from consuming Worker invocations.

The existing deployed budget bundle differed from repository source in an unrelated exchange read ceiling (3 deployed versus 7 in source). Deployment patched only the ESPN certification entry in the fetched live bundle rather than overwriting that difference. Future general budget deployments should reconcile it separately.

## Deploy and verify

Use the existing account and repo-pinned Wrangler. The deployed `ESPN_TOKEN_SHA256` secret stores only the SHA-256 digest of the existing plugin bearer credential. Never commit the credential; repository plugin source uses an environment reference. The account-budget class/namespace must remain unchanged.

```
npm ci --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund --prefix services/account-budget
node --test test/espn-mcp.test.mjs test/account-budget-admission.test.mjs test/account-budget-runtime.test.mjs test/job-execution-budget.test.mjs test/wager-authority-gate.test.js test/probability-integrity.test.js
npx wrangler deploy --config services/espn-mcp/wrangler.jsonc --dry-run
npx wrangler deploy --config services/espn-mcp/wrangler.jsonc --keep-vars
```

For one-shot remote verification, provide the existing credential through a protected environment, then run `node scripts/verify-espn-mcp.mjs`. Optional inputs: `FBIS_ESPN_DATE=YYYYMMDD`, `FBIS_ESPN_MCP_URL`, `FBIS_ESPN_REPORT`. The default date uses America/Chicago. No schedule is installed.

## Verification and observed failures

At 15:31 CST on November 6, production returned 5 CFB games, 9 NBA games, 72 CBB games and 3 NHL games. CBB had one live game and 71 scheduled games; the other sports were scheduled. Full paginated directories returned 762 CFB, 30 NBA, 362 CBB and 32 NHL identities. All scoreboard team IDs existed in the matching directory except 14 CBB opponent IDs; those IDs and names were still present in game records. ESPN did not provide a Last-Modified or per-game update timestamp. The evidence file records each verified event, directory IDs, provenance, summary samples and all omissions.

Observed before repair: Python urllib requests to the old shared Worker received HTTP 403 / Cloudflare 1010. Node requests could initialize and list tools, but a CBB call returned `Provider unavailable or request timed out`. That error was plain text inside the MCP content, not valid structured source data. Direct ESPN and all repaired production verification requests succeeded. No placeholder live records were used.

The first local budget runtime test failed because account-budget's separately pinned Miniflare had not been installed; installing its existing lockfile resolved the environment failure. All relevant tests subsequently passed.

Plugin version 1.1.0 was saved and read back with the new endpoint and streamable-http transport. This running ChatGPT session still did not expose the plugin tools in its tool registry. Native ChatGPT tool invocation still requires verification in a refreshed plugin session; authenticated HTTP MCP initialization, tool discovery and calls are independently verified. Browser host security policy blocked a direct ChatGPT plugin-page check; no bypass was attempted. Historical November 5 final scores and matching summaries passed for all four sports.
