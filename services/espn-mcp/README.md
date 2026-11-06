# FBIS ESPN connector

The private `fbis-espn` plugin now connects to `fbis-espn-mcp` rather than the shared source hub. The old shared Worker and its PinnOdds/Torvik connections remain unchanged. The ESPN Worker has no models, wagering logic, market data writes or scheduled handler. OAuth adds a separate, bounded authentication-state Durable Object.

## Release 1.3.0: ATP/WTA tennis, November 6, 2026

Two read-only tools extend the existing server and `espn:read` scope without replacing the native web plugin or its OAuth grants:

- `espn_tennis_scoreboard`: `tour` (`atp`/`wta`), optional `date` (YYYYMMDD), `match_type` (`singles` default, `doubles`, `all`), `tournament_id`, `offset`, `limit`. Default page size 25; maximum 100.
- `espn_tennis_match`: `tour`, `date`, `tournament_id` (such as `13-2026`) and `competition_id` (such as `186500`). Reads one match from the same dated tournament scoreboard; it does not imply a separately validated summary API.

Both use exactly one bounded ESPN GET under the existing certified scoreboard job: no additional budget allowance, collectors, polling, D1/R2 writes, model changes or wager authority. OAuth clients, keys, CSRF checks, scopes, state namespace and budget policy are unchanged. The existing seven team-sport APIs retain their schemas and behavior.

### Tennis data contract

ESPN tennis `events` represent tournaments. Their `groupings[].competitions[]` contain the matches. A tournament date or status must never become a match date or status. The new tools return competition-level date, status, round, court, source player IDs, winner flags, set-game scores and tiebreak values. They preserve numeric zero values. Singles competitors remain athletes; doubles competitors retain their two individual roster players and separate team ID. Player IDs are cross-checked across source fields/official ESPN player-card links; unresolved or conflicting identities are reported in rejection counts rather than replaced with invented players.

The explicit/default date filters matches in America/Chicago. ESPN receives a single YYYYMMDD date lookup, which selects tournaments and can include all their rounds across several days. The tool filters competitions by their own dates and exposes source tournament count, competition count, rejected draws/dates, provider calendar zones, source URL and fetch/source timestamps. **Coverage is limited to tournaments included by ESPN's date lookup.** It is not a complete Challenger/ITF calendar or global player directory. A late Chicago-day match in a tournament omitted by that ESPN calendar-date response is outside this result.

Testing found ESPN tennis range queries unreliable: `dates=20261106-20261107` returned an unrelated ATP tournament and no WTA tournaments despite valid daily responses. Range queries are therefore not used. This was an HTTP-200 semantic failure, not a provider HTTP error. All production verification uses the supported single-date path.

Unknown match times retain `timeVerified=false`. No venue-based surface inference, official-rank claim or tournament-seed reinterpretation occurs. Missing surface, status, provider score and provider update times remain null. `setsWon` is only derived from explicit ESPN set-winner flags for live/final matches, and its source is labeled. Pregame values are not presented as live scores. Per-side statistics are returned only when present in the source. Today's verified scoreboards did not include serve/return statistics.

### Verification and ChatGPT connection

All 85 targeted tests passed. Production passed 24 tennis checks plus the 25-check OAuth/team-sport regression. November 6 results at verification were ATP 4 singles / 4 doubles and WTA 13 singles / 9 doubles. Match details, participant IDs, dates, final set scores, pagination and NBA regression passed. The native existing `fbis_espn_status` call returned version 1.3.0 and tennis capability through the authenticated ChatGPT plugin.

The running chat's imported tool list still contains the previous four tools. Refresh the **connected native ESPN web plugin** to import the two new tools, then start a new chat if necessary. The old downloadable desktop package is separate and does not control this web tool snapshot. No connection-key rotation or re-creation is required. Native invocation of the new tennis tools remains pending that refresh; direct authenticated MCP calls to both new tools are verified.

Use `node scripts/verify-espn-tennis.mjs` for one-shot validation, supplying the existing key through protected `FBIS_ESPN_MCP_TOKEN`. Optional inputs: `FBIS_ESPN_DATE`, `FBIS_ESPN_TENNIS_REPORT`. Reports contain no credentials. Existing OAuth verification now expects six tools and version 1.3.0.

## Release 1.2.1: browser form submission repair, November 6, 2026

A real Chrome form submission reproduced `invalid_request` before checking the entered key. The authorization HTML inherited `Referrer-Policy: no-referrer`, which causes basic HTML form POST requests to carry an opaque/null Origin. The strict same-origin POST check therefore rejected a legitimate browser request. The earlier HTTP smoke test set Origin explicitly and missed the browser behavior.

The HTML form now uses `Referrer-Policy: same-origin`. Cross-origin referrers remain suppressed. Origin validation, signed request expiry and the CSRF cookie are unchanged; missing or null origins still reject. The form CSP permits only the FBIS origin and `https://chatgpt.com`, so Chrome can follow the server-validated ChatGPT callback after a successful submission. This does not change the callback allowlist or tool authorization.

Chrome validation before deployment returned the exact generic error; after deployment the same deliberately invalid key reached the intended key-validation message. No real key was entered through browser automation. All 74 targeted tests and 25 live HTTP OAuth checks passed. The native ChatGPT owner login still requires the user's real connection attempt. There are no budget, model, storage-policy, credential or wagering-authority changes.

## Release 1.2.0: web OAuth, November 6, 2026

The endpoint now supports protected-resource metadata, authorization-server discovery, Dynamic Client Registration (DCR), owner approval, authorization-code exchange with PKCE S256, one-hour access tokens, rotating refresh tokens and refresh-grant revocation. OAuth and the original bearer-key connection coexist. Public MCP initialize/list/ping requests expose only tool metadata. Every tool call still requires valid authorization; all four tools advertise the `espn:read` OAuth scope.

The existing ZIP plugin remains a desktop package. A ZIP upload is not a native ChatGPT web MCP registration. Create the web connection through **Plugins → + → Add custom MCP server**, using:

- Server URL: `https://fbis-espn-mcp.coachhornsby.workers.dev/mcp`
- Authentication: OAuth
- Registration method: Dynamic Client Registration (DCR)
- Read scope: `espn:read`
- No manually supplied client ID, secret, endpoints or OIDC configuration.

Close and reopen the unfinished connection form if it retained the old discovery error. The discovered metadata now advertises DCR, PKCE and the server endpoints. After creating the connection, install/select the resulting web plugin and perform a real ChatGPT tool call. Native ChatGPT registration and sign-in require the owner's session; a successful HTTP test does not prove those steps are complete.

### Owner sign-in

The authorization page uses the existing FBIS ESPN private connection key as the owner credential. Download the original private ESPN plugin ZIP, open `mcp.json` or `.mcp.json`, and copy the value after `Bearer ` in its Authorization header. Enter only that value into the password field on `fbis-espn-mcp.coachhornsby.workers.dev`. Do not enter it into the ChatGPT OAuth client-ID or client-secret fields. The key never goes into URLs, OAuth tokens, callback parameters, HTML output or logs. The existing SHA-256 secret remains the verifier. No ESPN account credentials are needed.

### Authentication constraints

- Registration is restricted to exact ChatGPT callback paths on `https://chatgpt.com`, with no query, fragment or alternate host.
- DCR client IDs are signed registrations, not authorization credentials. They expire in one year. Only owner approval issues authorization codes.
- The owner approval form uses an expiring signed request, a Secure/HttpOnly/SameSite cookie, same-origin POST verification and an explicit read-only consent button.
- Authorization codes expire after two minutes and are single-use across concurrent requests and Worker restarts. Codes bind the client, exact redirect, resource and S256 challenge.
- Access tokens bind issuer, audience, owner, client and the sole read scope. Access lifetime is one hour.
- Refresh grants have a 30-day absolute server-side lifetime. Rotation invalidates the old refresh token atomically. Revocation blocks further refreshes; issued access tokens expire within one hour.
- `ESPN_OAUTH_SIGNING_KEY` is a generated Worker secret. It is never committed or included in plugin packages.
- One owner-state record is capped at 32 KiB, 16 active grants, 64 unexpired used-code markers and 1,000 successful state mutations per calendar month. There are no alarms, scans or polling.
- Every token-state operation first reserves the new certified `services/espn-mcp/oauth.mjs` job: 10 micro-USD and a single bounded state RPC. The existing shared cycle allocation, reserve, ledger, unit ceilings and $8 application stop were preserved. No budget increase was made. Fixed record/input limits and existing 100 ms Worker CPU limits constrain each operation; the duration accounting reservation is not a Cloudflare billing hard cap.

### Validation

All 73 targeted tests passed, including actual SQLite-backed replay prevention, concurrent redemption, refresh rotation and recovery after restart. The live one-shot verifier passed 23 checks: metadata, DCR, sign-in, CSRF rejection, wrong-key rejection, PKCE, exchange, replay prevention, authorization, legacy compatibility, four sport scoreboards, refresh rotation and revocation. Its test grant was revoked. Credentials, authorization codes, cookies and tokens are excluded from the report.

Run `node scripts/verify-espn-oauth.mjs` with the existing connection key supplied through `FBIS_ESPN_MCP_TOKEN` in a protected environment. Optional inputs are `FBIS_ESPN_DATE` and `FBIS_ESPN_OAUTH_REPORT`. Keep the separately pinned account-budget test dependencies installed before the runtime tests. Deploy with the existing Wrangler configuration and `--keep-vars` to preserve secrets. The `espn-oauth-v1` migration provisions only the new `EspnOAuthState` class; it does not change the account-budget namespace or models.

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

Plugin version 1.1.0 was saved and read back with the new endpoint and streamable-http transport. At release 1.1.0 this running ChatGPT session did not expose the plugin tools in its tool registry. Native ChatGPT tool invocation still requires verification in a refreshed plugin session; authenticated HTTP MCP initialization, tool discovery and calls are independently verified. Browser host security policy blocked a direct ChatGPT plugin-page check; no bypass was attempted. Historical November 5 final scores and matching summaries passed for all four sports.
