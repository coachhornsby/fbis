# Polymarket US pregame REST integration (default off)

Official sources checked November 8, 2026:
- https://docs.polymarket.us/llms.txt
- https://docs.polymarket.us/api-reference/events/get-events
- https://docs.polymarket.us/api-reference/markets/get-market-bbo

The retail public gateway differs from authenticated trading/WebSockets and the
institutional symbol API. Public event responses supply market bestAskQuote and
bestBidQuote; side.quote is a separate app probability, not an ask. Dedicated
/v1/markets/{slug}/bbo exists but is NOT included in this implementation because
the existing job's network destination is exactly /v1/events.

## Implemented

An explicit FBIS_POLYMARKET_PREGAME_REST=true opt-in switches the existing
collector to at most four one-minute-on-each-side kickoff-window requests. It
rotates windows using the existing sport slot. Only independent fixture identities
and future starts qualify; provider live/ended/closed events are excluded.

Matched contracts retain the existing strict side, period, threshold and roster
validation. Best asks/bids become reference quotes, with unknown source update
time; the capture time is not misrepresented as the provider update time. App
probabilities are never substituted for missing best asks.

The existing one-write capture holds a compact quote snapshot and page counts
rather than raw large pages in this mode. The card reader opts into this snapshot
using its existing one-read allowance, labels transport REST, and uses the same
retained-reference rendering and links. It does not read REST and WS together or
fall back through a denied route. No D1 calls or WebSocket staging in this mode.
A failed/empty fetch does not erase the previous envelope. All quotes remain
non-executable and cannot qualify, change projections, or authorize a wager.

## Limits and activation prerequisites

Nothing is activated or deployed by this change. Default behavior is unchanged.
No job certificate, budget limit, cron, credential or public endpoint is added.
Enable only through an approved operational rollout after confirming the existing
job admission and schedule fit the account-wide budget.

Coverage remains explicitly partial: one page contains at most 20 events per
kickoff window, and at most 50 verified contracts are retained in a capture.
Rotating captures do not constitute an exhaustive league catalog. Existing browser
retention keeps missing partial rows; a new client only sees the latest server
capture. Durable per-contract accumulation across captures would require an
additional admitted read/merge and is NOT smuggled into the existing one-read job.
The existing cron is not changed to the user's proposed two-hour cadence here.

No live upstream pull was executed as part of this patch. Tests use deterministic
provider responses under actual execution-lease wrappers. Dedicated BBO endpoint
integration and production receipt verification remain separate follow-ups.

## Validation

48 focused tests pass across pregame capture/board integration, budget boundaries,
retained quote delivery, identity matching and UI rows. Tests prove the existing
one fixture read / one capture write and one board read, four-request maximum,
manual redirects, denial without retry, non-executable flags, stale preservation,
and rejection of live events and crossed quotes.

An older polymarket-card-delivery.test.js test still expects a retired D1-backed
endpoint to return 200 instead of its current fail-closed 503. It fails identically
on unchanged main b02579a and is not changed by this patch.

## Contract identity hardening

The collector rejects a repeated source slug if two identity-validated candidates
disagree on canonical fixture, kickoff, market family, or display binding. This includes conflicting source
outcome IDs, sides, periods and thresholds. The last good capture is preserved;
identical repeats may still update quotes. This check applies before any capture
write or stream staging and adds no requests, storage operations or activation.
Offline regression tests reproduced three silent replacements before the fix
and verify all three are rejected afterward. No live capture is implied.

Reference quotes are recorded only for identity-validated candidates, so an
unsupported duplicate period or unbound outcome is ignored and cannot replace a
validated contract’s price. Identical repeats still publish refreshed reference prices.

## Follow-up validation (November 8, 2026)

After the identity hardening, 87 focused offline market, admission and budget
checks pass. The repository-pinned Miniflare 4.20260730.0 was installed from the
official npm registry using the committed lockfile with lifecycle scripts off.
All 14 tests across `polymarket-rest-runtime.test.mjs`,
`kalshi-market-runtime.test.mjs`, and `kalshi-job-budget-runtime.test.mjs` pass.
These cover local simulated provider responses, signer/admission boundaries,
REST/WS/R2 plumbing, paused policies, duplicate slots and byte ceilings.
An additional 48 Kalshi collector/cursor/freshness/readiness tests pass.

This is local integration evidence, not fresh production captures. No collector,
schedule, budget or production deployment was changed. The REST runtime suite
covers the existing staged-WS route; default-off pregame REST delivery is covered
by the focused injected-provider capture-to-reader tests, not a deployed run.
