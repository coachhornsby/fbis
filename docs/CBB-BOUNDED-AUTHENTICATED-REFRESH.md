# FBIS bounded authenticated refresh — runner ready, live capture blocked

The two-request refresh runner is implemented and tested. No new authenticated KenPom or CBBD response has been captured in this phase. The blocker is credential execution access, not a successful refresh with empty results.

## Verified access state

Cloudflare Pages production has secret-text bindings named KENPOM_API_KEY and CFBD_API_KEY. The metadata API does not return their values. Preview has neither binding. The current local runner preflight reports both credentials absent. The existing orchestrator Worker lists no matching provider secrets. No separate callable secure provider runner was found.

Production remains the static deployment a31b98ad-8646-4134-ba83-927360f0873f at commit 43ac237c8236605eea64fe4f979e89bb5f25716b. No production setting, secret, route or Worker was changed. Existing production-only credentials cannot be used by a local or preview process merely because their names are visible in metadata. The expired/consumed earlier capture permit is not reused.

## Implemented capture contract

`runCbbAuthenticatedRefresh` accepts securely injected provider credentials, a short-lived explicit lease, an atomic claim callback and a private save callback. It has exactly two hardcoded GETs:

1. CBBD `/ratings/adjusted?season=2027`.
2. KenPom `/api.php?endpoint=ratings&y=2027`.

No directory, roster, prior-season, FanMatch, Four Factors or per-team calls. No arbitrary URLs, schedules, D1 queries, writes to models or wager operations. The source ledger is a private persistent consumed-run marker and capture receipts, not the existing recurring D1 acquisition mechanism. This local runner does not alter or reset that mechanism.

A lease must carry a valid unique run ID, season 2027, maximumRequests=2, issuedAt and expiresAt. It may last at most ten minutes and cannot start in the future or after expiry. Both keys must be present before the lease is consumed. The atomic claim happens before network access. The CLI stores consumed-run markers outside individual output directories with restrictive permissions; keep that claim directory persistent and use one runner. These filesystem markers are not a cross-host lock and the tool must not be scheduled or run on multiple hosts.

Each provider receives at most one attempt. Redirects are not followed. Transport/HTTP/authorization/quota/invalid-payload failures stop the batch without retries. CBBD must report more than 100 remaining calls; unknown/low remaining stops before KenPom. Responses are byte-bounded to 4 MiB, must be arrays below the known 3,000-record truncation ceiling and must identify season 2027. An empty current response stays empty, not a prior-season substitute. Bodies that reflect either credential are rejected; error records do not contain raw provider bodies, thrown messages or headers with credentials. Response rows are never printed to the console.

Original response bytes, server Date/Last-Modified, begin/receipt timestamps, row count, byte count and SHA-256 go to private output. A current retrieval time does not certify a new provider model-update time. Capture completion never means projection readiness or an approved wager.

## Secure runner procedure

Use a trusted runner where existing credentials are already injected as masked environment secrets. Accepted variable names: KENPOM_API_KEY and CBBD_API_KEY (or existing CFBD_API_KEY). Do not paste values into the handoff, Git, command arguments or archives.

Check presence without network calls:

```sh
node scripts/cbb-authenticated-refresh-local.mjs --preflight
```

In that same private runner, create a new lease JSON with a unique run ID and actual current issuedAt/expiresAt (at most ten minutes apart), season 2027 and maximumRequests 2. Then run:

```sh
node scripts/cbb-authenticated-refresh-local.mjs /private/new-lease.json /private/new-cbb-capture
```

Use a new output directory and a persistent private parent directory. Do not delete claim markers to force retries. Missing keys cause zero attempts and no consumed lease. Save returned source JSON/metadata/receipt in a private archive and return a private Drive link and hash for normalization. No secrets belong in the archive. If live capture is stopped, report its actual receipt rather than changing timestamps on older inputs.

The repo does not install, schedule, activate or automatically invoke this runner. It cannot read Cloudflare's production secret vault from outside that runtime. A new runner needs the existing keys configured securely by their owner, or a separately reviewed runtime deployment able to use the current production bindings. Neither happened in this phase.

## Validation and next action

Eight focused tests cover missing keys, malformed/expired leases, atomic replay prevention, exactly two calls, authentication/quota/redirect/transport stops, empty current feeds, response bounds/season checks and credential reflection. Existing CBB comparison/readiness/fixture/projection/static-board suites also run, for 45 passing Node tests. Preflight made zero provider calls.

Next action: establish credential access on one trusted runner. Grok should report only whether its existing secure environment has the two provider credentials; do not request or copy values into the handoff. If absent, Bryan must configure existing credentials through that runner's masked secret controls or explicitly authorize a reviewed production-runtime capture. Live refresh remains BLOCKED until one of those paths exists. No claim of completed authenticated capture, refreshed primary forecasts or production restart.
