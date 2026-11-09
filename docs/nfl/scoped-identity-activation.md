# One-run NFL identity (inactive)

The pure verifier does not grant access by itself. No credential, Worker route,
workflow, live grant or policy has been created by this module.

Activation must pin the reviewed repository IDs, exact main commit and workflow,
run ID, first attempt, and a maximum one-hour window. The workflow must request
only audience `fbis-nfl-once:<runId>`. Tokens are validated using the fixed GitHub
issuer keyset and are never sent to it. Both documented legacy and immutable-ID
main-ref subjects are accepted only with the same separately pinned numeric IDs.
Environment/custom subjects are rejected.

Required integration safeguards:

1. Run the NFL-specific route before generic orchestrator authorization. Disabled
or unknown NFL operations must never fall through into broad routes.
2. Explicitly deny this workflow in BOTH existing broad OIDC authenticators,
regardless of its requested audience. An OIDC-enabled workflow can request a
second audience; audience isolation alone does not restrict the workflow.
3. Bind only the two reviewed fixed NFL paths, six exact one-shot operations,
source/output hashes, predecessor ETags, future-game cutoff and existing budget.
Do not add R2 listing, arbitrary paths, cron, provider fetches, or other dispatch.
4. Pin the exact reviewed code and one attempt. Persist the attempt record before
any operation. Unknown outcomes are not retried or reassigned new reservation IDs.
5. Complete approval at the actual access-changing action using the user's
specific scope, and surface any required approval form. Do not treat this code
review as deployment approval or claim a protected environment is configured.
6. Verify the bounded operation and final public result. Disable/expire the grant
once used; do not copy a broad Cloudflare control token into the workflow.

The signing keys in tests are ephemeral test keys, never connection credentials.
These tests establish identity checking only, not a live GitHub/Cloudflare smoke test.
