# NHL injury and Tennis SportScore mission — 2026-10-27

Tracking: https://github.com/coachhornsby/fbis/issues/1814

## Independently verified baseline

- Main and Pages SHA `e2bb876c17ec0c00ef900d49967956abc620ac1e`.
- Pages deployment `3d1bee59-f850-44ba-8150-de9e182d1ef7`.
- Deployed NHL product routing: `SPORT_DB_MODE_NHL=sport`, `SPORT_DB_STRICT_NHL=true`, receipt `nhl-20261022-production-v1`. Older `NHL_SPORT_DB_MODE=shadow` also exists; use current productSportDbHandle contract, never caller override.
- NHL D1 `a0aa010c-40d3-4d2f-8109-eca4e74e2a73`: 173,092,864 bytes; 82 goalie profiles: 37 DEPTH, 13 EXPECTED_G1, 32 LAST_CONFIRMED_STARTER; 32 teams total; zero confirmed starters. Latest profile clock 2026-10-26T23:12:08.876Z. No shared availability table, no dedicated injury table. PRIMARY NHL shared availability rows: zero.
- PRIMARY `b50c724c-903b-4241-8ce1-48d931e7a44c`: 7,424,598,016 bytes at read. No new writer introduced.
- Tennis D1 `c491e479-f9f6-49a9-ace9-962aef68cc64`: 27,459,584 bytes; 363 external fixtures, 610 free-current research matches, zero availability observations. Tennis product mode remains shadow; canonical player/profile reads remain PRIMARY. No cutover/config changes.
- Live Oct 27 NHL board: 11 games. CBJ at PHI: board 401892585; both official schedule profiles agree on 2026020188, 23:00Z, opponent and venue. The new detail endpoint loads persisted profiles independently of expensive model collection deadlines.
- NHL profile workflow existing schedule: 02:20,11:20,19:20 UTC, eight serial four-team batches. Existing official infrastructure reads rosters, schedules, pregame boxscore and scratches. Scratch/absence is not an injury designation.
- Tennis live board returned 110 entries; existing canonical player, historical profile, official schedule, TennisMyLife current-season, Elo and source identity infrastructure already exists. ESPN Tennis retirement preserved.

## Sources and rights

| Source | Observed response | Decision |
|---|---|---|
| Existing official NHL pipeline | Stored 32-team roster/goalie/schedule profiles; no structured injury feed verified | Reuse for read-only game context, never infer injuries |
| Official team injury announcements | No complete permitted machine-readable 32-team source verified in this mission | Coverage remains UNVERIFIED; no claim of healthy teams |
| ESPN NHL injuries | HTTP 200; 29 team groups, 127 players, report timestamp 2026-10-27T05:02:34Z; status/date/details.type/returnDate; athlete lacks direct id in observed first row, provider ID only in links | BLOCKED pending explicit automated extraction/storage permission. No schedule, ingestion or redistribution activated |
| SportScore direct | Anonymous HTTP 200, 50 matches; four later detail requests; see observed JSON | Reject activation at present: inconsistent/stale detail responses, absent requested stats, attribution gate |
| SportScore RapidAPI | Anonymous HTTP 401 Invalid API key | No authenticated evaluation; missing free entitlement/key and verifiable terms/quota/overage |

ESPN restrictions: https://disneytermsofuse.com/english/ §2.B.x restricts automated collection/database compilation without written permission. No further ESPN acquisition after this restriction was verified. Source observations were isolated evaluation, not production ingestion.

SportScore direct: https://sportscore.com/developers/ and https://sportscore.com/developers/terms/ . Public base `https://sportscore.com`, documented `/api/widget/matches/` and `/api/widget/match/`. Terms advertise approximately 10,000 requests/day/IP, 60s caching, no key. Cache and derived products permitted; bulk feed redistribution prohibited. Requires real visible crawlable dofollow attribution on every data surface, explicitly excluding client-only badges bots cannot execute. Current FBIS React interface does not establish that condition. No SportScore records admitted to D1/R2 or live UI. Public repo availability alone does not remove attribution requirement.

RapidAPI candidate base tested `https://sportscore1.p.rapidapi.com/api/v1`; anonymous 401 does not verify supported authenticated routes or quotas. Pricing page did not expose usable plan details. Do not assume relationship to direct service.

## Direct response completeness

50 list records: 29 ATP Challenger, zero observed ATP main-tour, 20 WTA singles (15 main-tour +5 125K), one WTA doubles. Nine competition labels. This does not meet a main-tour ATP 20-match acceptance target. No documented date/page/tour filter on the bounded list endpoint establishes how to obtain that target; do not relabel Challenger as main tour.

| Category | Finding |
|---|---|
| Fixtures | PARTIAL: names, competition, ISO time and match slug; source-native stable match/player IDs absent from list; time accuracy not independently certified |
| Players/rankings | PARTIAL names; rankings/identity stability UNVERIFIED; no stable player IDs in tested responses |
| Results | PARTIAL/inconsistent: list set-win totals, no per-set game scores; three of four evaluated detail responses disagreed with the earlier list |
| Serve/return, aces, double faults, break points | UNAVAILABLE in four tested details: stats arrays empty; no field values |
| Surface/indoor | UNAVAILABLE in tested list/details |
| Tournament/round/format | PARTIAL tournament label; no round/format fields |
| Withdrawals/retirements/walkovers | UNVERIFIED; one Canceled label cannot establish cause or settlement semantics |
| Freshness | PARTIAL detail `updated` exists; list has no provider update clock. Three details were hours old; one later corrected while evaluated. True event-to-observation latency unmeasured |

No verified incremental advantage over existing sources established. No paid activation, quota-consuming authenticated requests, or new collector.

## Implementation delivered by this branch

- Read-only `/api/nhl-intelligence?id=...`: canonical stored game identity; deployed routing; current persisted profiles; independent exact official schedule crosswalk; explicit missing injury-store and source permission states. Does not fabricate zero injuries.
- Normalized verified injury presentation uses existing shared observation contract when available, with required canonical identity, source URL, verification metadata, original and collection clocks, event match, stale status and historical transition selection. No schema or migration needed until a rights-qualified collector is admitted.
- Goalie card guard rejects fixed hierarchy estimates as sourced projections, and vetoes known unavailable players. Does not touch model resolver, production champion, probabilities, or wager authorization.
- Expandable NHL detail section and Tennis player/match research section in existing AdvancedGameDetail. Tennis bounded read API uses exact unique canonical identities; preserves missing data and source clocks. No guessed aliases or official record overwrite.
- Dedicated offline contract CI; local unit/integration checks and Vite build.

## Unfinished acceptance / exact remediation

1. **Automatic NHL injury intelligence NOT complete.** Need a permitted structured official source or ESPN written automated collection/storage permission. Then implement sole-owner pregame collector, shared schema on authoritative NHL D1, append-only transitions, dedupe, source/team health receipts and raw evidence retention as permitted. No historical deletion.
2. **Confirmed starters zero.** Official persisted pipeline has no current confirmations. Need actual explicit pregame announcements with game/team/source clocks. More frequent free polling needs cost verification; this release does not create it. Fixed hierarchy values are not sourced projections.
3. **SportScore 20 ATP main-tour sample not complete.** Need documented coverage/pagination or actual suitable available sample. Direct output is not reliable enough for integration. RapidAPI requires key, verified zero-charge entitlement/overage controls and usage terms.
4. **Source freshness/stability, independent identity matching and update-delay tests incomplete** for SportScore due absent stable IDs, missing statistics and inconsistent details. No promotion until fixed.
5. **No new D1 migrations or writes.** Binding verification is read-only, preserving existing authority; absence of injury storage remains explicit.
6. PR CI, production release SHA, API readback, full-slate and rendered desktop/mobile checks must be recorded after release. Do not treat this document as evidence they passed.

Mission remains partial. Source restrictions block the primary new acquisition objective; a usable diagnostic UI is not equivalent to a functioning injury feed.
