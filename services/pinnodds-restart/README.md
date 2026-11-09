# Bounded PinnOdds restart preparation

Status: OFFLINE PROTOTYPE, NOT CERTIFIED OR DEPLOYED. No route, scheduler,
workflow, budget-policy entry, credential change or provider call is enabled.
Existing $10 target and account hard stop are unchanged. Local source baseline:
be587e7f5b88948e1282342557e9e587bef550c1.

## Verified failure

On November 9 the production latest football receipt still points to October 27
10:55:44Z; basketball to October 27 13:24:59Z. Both recorded fresh provider data
and reconciled matches at the time. The orchestrator has no cron schedules.
PinnOdds workflows remain paused. Current static publication redirects every
/api/* path to api-unavailable.json. Old collection depends on three of those
paused APIs (status, capacity, ingest), and its worker is not in the execution
job certification allowlist. Re-enabling the old workflow is not a repair.

## Proposed smallest restart

1. Review this code and independently cost/certify an account-only job. Bound
   one coordinator admission attempt and its storage/CPU overhead, then use an
   existing authorized authenticated transport. Current code deliberately has
   no route and adds no allowlist entry. No broad orchestrator admission.
2. checkAccountOnce: exact fixed job/id, three MCP HTTP requests maximum,
   196,608 response bytes, two R2 writes totaling at most 4,096 bytes, no odds
   requests, reads, lists or D1 activity. Fixed immutable attempt survives
   failures. Inspect sanitized active/free-plan/quota outcome.
3. Only after authorization/admission, separately certify captureOnce:
   rechecks account (3 HTTP), makes exactly one football prematch request (1
   HTTP), include_specials=0, no drops/live or player-prop requests. Total
   response cap 2,293,760 bytes; raw cap 2,097,152 bytes; 2,000 source events;
   three R2 writes capped at 2,162,688 bytes. No R2 reads/lists or D1 access.
   Current guard retains at least 10 provider requests. Account-wide quota
   concurrency must be reconciled before activation, not inferred from this
   isolated check. Runtime CPU, coordinator calls and durable ledger overhead
   still need explicit reviewed admission and runtime limits.
4. Claims use fixed immutable paths under market-sources/pinnodds/restart-v1.
   Never change a failed attempt ID to retry. Reconcile any uncertain result
   first, then obtain a separately reviewed operation if necessary. No retries
   or redirects. The provided functions fail closed under existing policy.
5. loadTrustedArchive reads only the fixed receipt and its hash-derived raw
   key under an independently admitted 2-read/2,113,536-byte lease. No provider,
   lists or writes. prepareTrustedPublication derives up to 100 exact football
   fixtures from fresh (5 minute) independent ESPN scoreboard rows and connects
   the loader to a sanitized public packet. No raw archive keys/provider blobs
   are published. The local CLI also creates a deploy-compatible board file
   without overwriting inputs; CLI inputs must be trusted loader exports, not
   arbitrary uploaded assertions.
6. PublicationApp now retains this static packet separately across live score
   refreshes and reconstructs display-only fields. Deadline/focus/visibility
   checks remove references at 45-minute expiry or kickoff, and on wrong date,
   identity changes or live/final status; no stale venue-offer fallback remains.
   Review generated rows and separately approve a static release. Browser visual
   verification and live archive/transport verification remain unperformed.
   No release workflow or automatic publisher invocation is added.

No fresh data or restored coverage is claimed. Quote time stays unknown;
collection time is never represented as provider quote time. No forecasts,
confidence, wagers, account balances, or independent-model inputs are changed.
Strict name/time matching intentionally leaves aliases unmatched for review.

## Offline checks

node --import ./test/offline-network.js --test test/pinnodds-restart.test.mjs test/pinnodds-markets.test.js test/pinnodds-account-usage.test.mjs test/pinnodds-governed-capture.test.mjs

The network guard makes unexpected external fetches fail. Tests use explicitly
injected fixture-only adapters, never deployed credentials or real providers.

## Plugin registration

Owned private plugin fbis-pinnodds 1.0.0 exists and declares the source-hub MCP
endpoint; deployed source-hub code lists PinnOdds events/drops tools. They are
absent from the current assistant tool catalog. No authenticated handshake was
performed, no credentials were reused, and no plugin settings were changed.
Thus plugin manifest absence is disproven; session registration/auth remains
unverified and is separate from the paused production capture path. Repairing
registration may expose provider calls that bypass this proposed admission;
review hub budget controls before enabling it.

## Validation results

48 targeted tests pass (restart, normalization, account usage and governed
capture), including recursive immutability, post-kickoff application rejection,
and exact sport/home/away/start identity enforcement after normalization.
The full legacy PinnOdds suite is not green: nine failures reproduce on the
untouched be587e7f baseline (capacity, six ingestion assumptions, active-source
assumption and paused workflow path). These are not reported as new regressions
or repaired here. JavaScript syntax checks and git diff --check pass.

Additional offline integration checks cover trusted loader denied/disabled gates,
fixed archive keys, oversized/lying streams, hash tamper, nested scoreboard team
identity, public payload sanitization, expiry/kickoff, false authority, retained
venue fallback removal and trusted publisher provenance. The actual publication
Vite bundle compiles (417 modules) with acquisition/copy plugin disabled and
existing installed dependencies. It emits the existing large-chunk warning.
No screenshot or visual browser claim is made. Budget diagnostic coordination
received the exact proposed units; live admission remains unapproved/unproven.

User-observed account context (November 9): Bryan reports the PinnOdds dashboard
shows zero requests today and recalls roughly 100 daily requests. This supports
paused collection rather than quota exhaustion, but is not an independently
verified active-plan or current provider entitlement receipt. Do not ask him to
repeat it; use the bounded account-only operation when admitted.

Expanded publisher/renderer sanitization now removes legacy Pinnacle/PinnOdds
headline/reference, pin-prefixed odds and CFB shopping fallbacks. Explicitly
unrelated provider prices and model values remain unchanged; public team totals
retain validated home/away scope. Public board regression suite is 13/15, with
the same two failures reproduced on untouched baseline (legacy call-count and
release-root assumptions). No new failures in that regression set.
