# Bounded Polymarket capture coverage repair

## Evidence and causes

The existing November 9, 2026 captures inspected at 13:31 UTC contained one CBB
fixture (Marshall at Ohio State, 13 contracts: one moneyline and 12 totals) and one
CFB fixture (Ohio at Miami OH, one one-sided moneyline). These are capture coverage
observations, not evidence that other games or market families were unavailable
at Polymarket. The CBB capture timestamp was 13:24:52 UTC; CFB was 13:22:52 UTC.

The collector previously spent its CBB list request on one kickoff minute, used
up to three exact-slug detail requests within that minute, and replaced the prior
capture. This made a fresh client see a tiny rotating subset. CBB's market ordering
also allowed alternate first-half totals to starve full-game families.

`INVALID_OR_STALE_FIXTURE_MANIFEST` has multiple possible causes. Offline tests
reproduce both an over-100 combined today/tomorrow manifest and a retained day
expiring immediately after the fresh day's publication. The exact cause of the
13:14 UTC production diagnostic was not proven by the available capture evidence.

CFB's old 72-hour identity limits independently excluded Saturday games on Monday.
Its collector did not request event details, even with unused capacity.

## Changes

- Pack verified fixture kickoff times into windows sized for twenty source events
  rather than one kickoff minute. A shared kickoff with more than twenty fixtures
  gets bounded page offsets. Use at most four requests total, including details.
  Plans requiring more calls rotate and remain explicitly incomplete.
- Use remaining calls for source-matched CBB/CFB event-slug details. A detail may
  enrich a REST list's long-only binding with a genuine opposite outcome only when
  every original fixture, kickoff, market family, long ID, side and line agrees,
  the provider event ID is the same, and the complementary binding validates.
  Existing opposite metadata conflicts still fail closed. Legacy/WS enrichment
  remains rejected. Missing opposite IDs are never fabricated.
- Balance CBB's existing 24-market inspection and CBB/CFB's existing 50-contract
  output across families and events. Strict market identity validation is unchanged.
- When two complete date scopes exceed the 100-fixture limit, retain the complete
  current Chicago day and explicitly record the omitted day in `coverageOmissions`
  with `coverageLimitReason: FIXTURE_UNION_CAPACITY`. No partially truncated day is
  labeled complete. A single-day overcapacity still fails before writing.
- Do not retain another date with less than two minutes of its original one-hour
  validity remaining. This prevents immediate expiry of the newly fetched date.
  No timestamp is refreshed for retained data and no expiry limit is extended.
- In active REST CFB mode only, retain up to seven days of identities already in
  the existing single ESPN current-week scoreboard response. No extra ESPN query,
  URL, pagination or schedule change is introduced.

## Seven-day contract and deployment dependency

Extended CFB fixture manifests carry `fixtureHorizonHours: 168`. Validation requires
CFB, that exact marker, and an explicitly REST-enabled caller. Unmarked manifests
and default validators retain the original 72-hour limit.

The REST envelope's `referenceSnapshot.fixtureHorizonHours` is also `168` for CFB.
Readers accept starts through capture plus 168 hours only with REST transport,
that exact marker, and CFB rows. WebSocket snapshots, unmarked snapshots and other
sports retain 72 hours. Fixture one-hour expiry, captured/received timestamps,
quote freshness, identity validation and non-executable status are unchanged.

Deploy the authenticated market-reader gateway's backward-compatible marker support
and Pages reader before publishing an extended collector capture. The parent
verified gateway deployment `95a6555a4b3d4e56be7d9e41d3fc26c2` at 13:37 UTC with the
existing settings and bindings. The existing paired-reference release workflow
still uses the final merged `github.sha`, shared Pages release lock, strict active
settings/binding/CPU/cron preflight, Pages first and REST collector last.

## Preserved limits and residual gaps

No new source, credential, public route, D1 access, archive listing, archive read,
archive write, budget grant, schedule or execution capability is added. The REST
job remains four provider calls, two MiB aggregate responses, one fixture read,
one capture write, 24 inspected markets per event and 50 retained contracts.
The worker CPU limit remains 100 ms. The fixture job remains one request; its
archive writer retains the existing head/get/conditional-put allowance.

Larger responses and more matching work can consume more of the unchanged byte
and CPU budget. Oversized responses fail closed, and no unbounded retry/fallback
is introduced. The local runtime test proves functional integration, not live CPU
headroom. Provider events unmatched to the known fixtures can consume list slots.
Packed windows and page saturation therefore still do not establish complete
coverage. A snapshot replaces its predecessor; it does not accumulate old server
quotes. Details only fill spare calls and rotate. Some games may remain one-sided
or lack derivative references. No price becomes executable or changes a projection.

## Offline validation

Deterministic tests cover 34 distinct CBB events across ten kickoff times in a
single four-call/34-contract capture, same-kickoff pagination, capped 100-fixture
rotation, family balancing, all previous binding conflict checks, genuine opposite
metadata enrichment, legacy rejection, current-day capacity fallback, near-expiry
scope rejection, REST-only seven-day CFB card delivery, default 73-hour rejection,
168-hour boundary enforcement and an oversized response stopped before writing.

The pinned Miniflare 4.20260730.0 suite includes a 34-game expanded-slate test using
actual local Worker, R2 and AccountBudget boundaries with a mocked provider. A dry
Vite publication build compiles without source acquisition. No provider requests,
production R2 operations, publication or deployment were performed by this patch.

## Follow-up: reserve useful details after broader discovery (superseded discovery plan)

The broad-range discovery described in this section was subsequently replaced
by the fixture-window restoration documented below. Its detail and roster
allocation safeguards remain in effect.

The scheduled 13:54 UTC CBB capture contained 27 matched games, all moneylines;
the 13:52 CFB capture contained five matched moneylines. These counts are not raw
provider page counts and do not establish the availability of derivatives or
opposite-side metadata. Offline reconstruction of the saved 50-game CBB schedule
produced four list attempts: an early nine-fixture range, two pages for a
21-fixture kickoff, and a late twenty-fixture range. Consequently no detail calls
remained. The saved 67-game CFB week likewise produced four list windows.

For CBB/CFB REST only, discovery now uses one range bounded by the eligible
fixtures' earliest and latest starts. It attempts page zero and proceeds to page
one only after a full twenty-event raw response. If both pages are full, one
further page rotates across a fixture-derived bounded set of later offsets.
A short raw page ends further list attempts for that range. Matched-event counts
never determine exhaustion. Two configured tags alternate with both tags included
in the recurrence period; production's existing single-tag bindings are unchanged.

At most three list attempts leave at least one detail opportunity when an eligible
matched event exists. Short responses free up to three detail opportunities. A
synthetic 27-raw-event response needs two list calls plus two details; five raw
events need one list call plus three details. This does not assert that the live
27/five matched captures had those raw counts or that details will contain quotes.

The saturated-case tradeoff is explicit: at most sixty list events plus one event
detail, instead of eighty list events and no details. The four-request ceiling,
twenty-event page cap, two-MiB aggregate response limit, CPU100 limit and fifty-
contract snapshot remain unchanged. The first two source pages stay anchored;
the later probe rotates. An empty higher offset consumes at most one attempt,
and the following run starts from page zero again. The fixture-derived offset
extent is a probe bound, not a claim about provider catalog size. Unmatched source
events can consume slots and matches can remain beyond that chosen extent.

Detail candidates are stable-sorted within their originating list pages, globally
deduplicated by exact slug, then interleaved across pages. Rotation advances using
the full discovery-plan recurrence rather than the raw cycle, avoiding periodic
subset starvation. Under pressure at the fifty-contract output limit, one verified
representative per available family from detailed events is reserved before filling
other slots. Remaining event allocation rotates so the same tail identities are
not always discarded. This can trade some simultaneous moneyline breadth for real
verified derivative references. No market, line, side or opposite ID is inferred.

Regression tests cover short/full/empty raw pages, unmatched events, two-tag
rotation, later-page detail fairness, output-cap fairness, and derivative retention
at both 49-event and sixty-event pressure boundaries. All completeness flags stay
false. Finite requests and the replacement-only fifty-contract snapshot cannot
guarantee every game and every family simultaneously.

## Follow-up: optional detail market-count overflow

The post-deployment CFB run at 14:12:53 UTC reported
`PROVIDER_MARKET_CAPACITY` and retained its previous capture. Without a new source
request, that diagnostic alone does not identify which response exceeded the cap.
The existing count guard aborts the run for both mandatory list data and optional
event detail, so one oversized enrichment could discard otherwise valid list data.

REST-only optional details now check for a genuine `markets` array with more than
200 entries after verifying the one-event response envelope and exact requested
slug. Such a detail is rejected in full before candidate, price, binding, matched-
fixture count or detail-priority processing. No prefix is parsed or retained.
Already validated list results and other valid detail responses can still publish
using the existing single capture write. The bounded `detailOmissions` metadata in
the capture and receipt records the requested event slug, capacity code, observed
count and unchanged limit. The returned error list also reports the omission.

Malformed market arrays, side-count overflow, envelope/slug errors, conflicting
identities in processed data, aggregate response-byte failures, and list-response
market overflow still abort before publication. Legacy/WS behavior is unchanged.
The 200-market response boundary, 24-market inspection boundary, four-call limit,
byte/CPU allowances and all storage budgets remain unchanged. This patch does not
prove the rejected source contained usable derivatives or paired outcomes, and an
oversized optional detail remains unavailable rather than partially trusted.


## Correction: restore fixture-window discovery with reserved details

After the optional-capacity release, the 14:22:51 UTC CFB matched snapshot contained
only Ohio versus Miami OH and no Saturday matchup. An earlier fixture-window
capture contained five matched games, four on Saturday. These are matched output
counts, not raw response sizes. They do not establish why provider responses differ
or imply that uncaptured markets are unavailable.

CBB and CFB REST discovery now returns to the previously exercised fixture-backed
kickoff windows. Up to three planned list queries rotate with stride three, leaving
at least one detail opportunity when an eligible matched event exists. A short or
empty response never suppresses a different window or a later planned page. No
broad-range response is treated as evidence that other fixture windows are exhausted.

For N planned window/tag queries, the subset recurrence is N/gcd(N,3) when N>3,
otherwise one. Detail rotation advances after that exact recurrence, retaining the
page-interleaved ordering and avoiding periodic subset starvation. The existing
200-market optional-detail omission, strict identity validation, seven-day CFB REST
marker, verified-family priority and fifty-contract output fairness are unchanged.
Other sports retain their existing four-window plan; legacy/WS behavior is unchanged.

The tradeoff remains explicit: each capture can cover at most three fixture-window
list pages plus a detail, and omitted windows rotate into later captures. A new
client can still see a partial replacement snapshot. The added deterministic tests
cover window/tag counts of one through ten, empty-window continuation, and a
synthetic CFB sweep containing both early-week and Saturday opportunities. These
tests do not promise that live provider details contain derivatives or paired IDs.

## Source-anchored CFB market detail

Official US documentation and its linked OpenAPI were checked on November 9,
2026. These are public documentation reads, not provider market-data probes:

- https://docs.polymarket.us/api-reference/markets/get-markets
- https://docs.polymarket.us/api-reference/market/overview
- https://docs.polymarket.us/api-reference/oapi-schemas/markets-schema.json
- https://docs.polymarket.us/api-reference/oapi-schemas/events-schema.json

`GET https://gateway.polymarket.us/v1/markets` documents market-level `limit` and
`offset`, string `gameId`, and `sportsMarketTypes` enum arrays. Arrays have
`explode: true`, so each value uses a repeated query key. The supported family
values used here are `SPORTS_MARKET_TYPE_MONEYLINE`, `SPORTS_MARKET_TYPE_SPREAD`,
and `SPORTS_MARKET_TYPE_TOTAL`. The documented `id` filter is an int32 array;
`slug` is a string array. The adapter does not mix ID and slug filters.

The event's numeric `gameId` is its sports-provider game ID, not `event.id`, an
ESPN ID, or an invented `event.game.id`. The market response contains only
`markets[]`; its schema does not promise an event/game parent link. Therefore
query scope alone cannot establish membership. Returned IDs/slugs must match
explicit source-authored references in the independently matched list event's
`markets` or `marketGroups[].marketIds`. Existing ID/slug/side/line/period conflicts
and any supplied contradictory parent fields fail before accepting any detail.
New derivatives without these source-authored references are not attached.

Only CFB pregame REST uses this path, replacing an existing reserved event-detail
slot. At most 24 known anchors are requested per call with `limit=24`, `offset=0`;
known anchor batches rotate across recurring detail opportunities. Anchor
inspection is itself bounded to 200 markets/references. Missing/unsupported
anchors retain the original event-detail path. A failed or empty replacement
never triggers an extra call, erases valid list quotes, or proves cancellation.
The bounded result is audited in `marketDetailPages`, always `complete:false`.

Both exact endpoint wrappers share one execution lease: four provider requests,
two MiB cumulative response bytes, one R2 read and one R2 write. The 24-market
inspection, 50-contract output, 200-market event limit, schedule, CPU setting,
source capture clock, and CBB/default/WS behavior are unchanged. No credentials,
private endpoints, International Gamma/CLOB calls, or retired bootstrap are used.
The exact `/v1/markets` public path is the only added endpoint allowance.

Documentation establishes a supported bounded query shape, not live success or
complete coverage. Historical `/v1/markets?gameId=...` empty results do not prove
which ID was used or whether current filtered requests return the required
sides. After review, verification must use an ordinary already-admitted scheduled
slot. Opposite outcomes still require genuine returned IDs and complementary
binding evidence. No provider availability or derivative coverage is promised.

### Remove only the redundant game filter

A fresh official OpenAPI check at 15:30 UTC confirms `/v1/events` supports
`tagSlug`, `startTimeMin`, `startTimeMax`, `slug`, `orderBy`, and `orderDirection`.
The source audit's earlier short parameter extract was not a complete list.
`orderBy` is a string array; accepted sort-field names are not enumerated, so
`id` specifically is not separately guaranteed. Three full source pages do not
prove ignored filters or unrelated events. Event discovery is unchanged.

The existing 15:22 CFB capture reports three 20-event list pages and one anchored
market response requesting one identity and returning zero. This proves that
specific filtered request returned no markets, not why it was empty or whether
the venue lacked markets. Historical `gameId` queries were also empty, but the
cause and identifier used in that historical check were not established.

The next narrow change removes only the `gameId` parameter from the reserved
`/v1/markets` request. Official ID-filter semantics independently restrict `id`
or `slug` to those exact market identities:
https://docs.polymarket.us/api-reference/market/overview#id-filters
https://docs.polymarket.us/api-reference/oapi-schemas/markets-schema.json

The source event's validated numeric `gameId` remains required for eligibility;
any contradictory `gameId` supplied in the response still fails. Exact source
membership, ID/slug consistency, existing family/period/line/outcome checks,
`limit=24`, `offset=0`, and the three `sportsMarketTypes` filters remain unchanged.
Keeping the family filter avoids deliberately requesting unsupported props from
otherwise valid group-only references. No new endpoint, fallback request, call,
byte/storage allowance or cadence is introduced; CBB and legacy are unchanged.

This is a documented bounded hypothesis for the next ordinary scheduled slot,
not a proven root-cause fix. If that result remains empty, do not continue changing
query parameters speculatively without new evidence.
