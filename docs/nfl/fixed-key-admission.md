# NFL fixed-key inspection boundary (inactive)

`inspectNflFeatureSnapshot(env)` is an internal service-binding primitive. It is not an HTTP endpoint, new collector, scheduled job, source updater, or model promotion. No production binding or budget policy is changed by this patch.

The only target is `R2_ARCHIVE.get("nfl/features/latest.json")`. The existing authenticated account-budget Durable Object RPC must approve the NFL-specific job and fixed reservation ID first. Exact ceilings permit one read, at most 8 MiB, no R2 lists/writes, no D1 and no source fanout. Coordinator overhead and 100ms runtime CPU must be independently approved in policy. The account stop and allocation checks remain unchanged. Missing grants, identity mismatch, caps mismatch, expired leases, missing/oversized/truncated bodies and uncertain reads fail closed without retry.

The result binds exact bytes to SHA-256 and reports inspection time. It does not establish upstream source observation, completeness, current-week coverage, model validity, or permission to publish. A consumer must independently verify a source receipt bound to that hash and enforce NFL-only identity, source observation/build time, future-game cutoff and both-team coverage. Never replace source observation with inspection time. Never use this path for college inputs.

## Activation prerequisites

1. Independently review this primitive and the model consumer. Test using the gathered NFL snapshot and separately validated source evidence. Do not rewrite started-game pregame records with newly observed data.
2. Provide a single authenticated, operator-controlled launch with an externally enforced one-attempt limit. `preAdmissionAttemptCeiling: 1` is policy validation, not a global throttle: repeated invocations can incur coordinator overhead even when denied. No public route or scheduler may directly invoke this primitive. The local `launchNflInspectionOnce` primitive now implements an atomic, file-and-directory-synced attempt marker before invoking an injected approved transport. Its parent directory must already be protected and all callers must use the same stable path. A real authorized service-binding gateway and operator launch remain unconfigured; this is not a public endpoint.
3. Confirm the current account billing/allocation evidence and separately approve coordinator overhead, exact units and CPU budget in the existing admission controller. Preserve the existing account cap; do not raise it. Code certification alone does not activate policy.
4. Verify the NFL ARCHIVE binding, exact fixed key and launch identity. A missing snapshot requires separately authorized publication, not an unbudgeted fallback or altered CFB inspector.
5. Inspect once, preserve actual outcome and receipt, and pass exact bytes to the independent consumer gate. An uncertain outcome is not retried. Any production snapshot write, model promotion, runtime deployment or new recurring collection is a separate action requiring exact scope.

The fixed reservation permits at most one successful read per budget period and is intentionally unsuitable for recurring serving. A repeatable production reader needs a separately reviewed reservation/attempt plan; do not randomize IDs to bypass this one-shot boundary.

## Inactive launcher and Worker runtime

`services/nfl/inspectionWorker.mjs` requires the existing ORCH control token and explicit enable flag. It accepts only an empty POST to its fixed inspection path. `wrangler.inspection.jsonc` defaults disabled, has no public routes, previews or schedules, and declares a platform-enforced 100ms CPU limit. No binding, secret or gateway has been provisioned.

The operator launcher is a local function, not a configured live transport. It opens a stable attempt marker exclusively, syncs both file and parent directory, then invokes once. The marker is never cleared on success, failure or uncertainty; no retry or alternative marker is permitted. A protected local POSIX filesystem with working fsync is required; failure to persist prevents invocation. This bounds the approved launcher, not arbitrary calls by other credential holders.

Offline testing exercised actual Worker dispatch, SQLite budget coordination, local R2, launcher replay prevention and coordinator duplicate denial. Installed workerd supports only an older compatibility date, so the test uses July 1 rather than the deployment configuration's October 1. The CPU declaration is statically checked against certified units; the tests do not demonstrate production CPU enforcement or worst-case 8 MiB completion within 100ms. Those remain deployment smoke/benchmark requirements, not claims of completed verification.

## Additional compatibility and real-data checks (2026-11-08)

Using official npm workerd 1.20261108.1 installed only in a temporary test directory, the real Worker/SQLite/R2 test passed at the configured October 1 compatibility date with the gathered 1,909,047-byte nflverse snapshot. The returned bytes match the input exactly, and replay is refused by both launcher and coordinator. The test supports `NFL_OFFLINE_SNAPSHOT`, `NFL_TEST_COMPATIBILITY_DATE` and the existing Miniflare `MINIFLARE_WORKERD_PATH` override without changing production dependencies.

Ten local Node inspection runs on that snapshot measured at most approximately 61ms process CPU and 60ms elapsed time. This is diagnostic only, not proof of Cloudflare CPU cost, cold-start performance, response serialization cost, or worst-case 8 MiB execution. Production CPU-cap enforcement and a budget-admitted deployment smoke remain necessary.

## Exact remaining production boundaries

- The current board deployment has a private CBB archive binding, not an NFL one. Do not repurpose it. The private inspection Worker requires its own explicit NFL R2 binding and the existing budget coordinator binding/account identifier.
- No authenticated service-binding gateway/transport is configured. Choose an already authorized private operator gateway, verify the calling identity, and use the same protected attempt marker path for all launchers. Do not add a public URL merely to reach this job.
- The existing budget policy does not automatically authorize the new inspection job. A fresh valid receipt/allocation and explicit exact units, coordinator overhead and runtime CPU declaration are required. Preserve the existing $8 internal stop and $10 overall ceiling; do not replace unrelated allocations.
- The new gathered snapshot is local only. This read-only primitive cannot publish it. First determine whether the fixed archive key already contains a valid NFL snapshot through a separately approved one-shot read. Any exact-key snapshot write requires its own bounded, independently reviewed writer/admission plan and exact authorization. No unbudgeted upload or legacy CFB endpoint fallback is permitted.
- A source receipt must be independently bound to exact snapshot bytes. Maximum included week 9 does not establish that week 9 is complete. Do not infer a completed-week claim from max week, object time, build time or HTTP Last-Modified. New Nov 8 observations cannot revise previously started games' pregame inputs.
- Consumer influence, future-game gating, published output provenance and NFL-only display still require verification in the actual production consumer. The inspection result itself does not authorize model promotion, recommendations or wagers.
