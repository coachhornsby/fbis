# Mobile board, ATP/WTA and portrait mission — 2026-10-27

Tracking: https://github.com/coachhornsby/fbis/issues/1818

Baseline main/Pages SHA 8956488445da7ac860103d3e2e9b17dd55d3baec, deployment c9a76af2-642f-43e6-8b0a-b3dc706c0c74. Platform mandate read. User reference screenshot shows large duplicated navigation, multi-row selectors, operator actions and health above the first card.

## Ownership

No changes to App.jsx (#1230), TennisMatchCard.jsx / tennisCardPresentation.js (#1260), tennisPortraits.js (#1139), shared player-image.js, or pro-sport image pipelines. Old PR #915 (last updated Oct 8) touches TodayView for ACTION/security; this mission changes its upper board presentation only, leaving ACTION/security and original status-filter predicates untouched. Shared AppShell edits were avoided after identifying older CFB PR overlap. New navigation icon treatments use scoped CSS.

## Changes

- Compact board header, CT date navigation, data refresh timestamp with explicit failed/cached states, horizontal sport/tour controls, segmented status filters.
- Secondary import/copy/retry/operator health inside Actions; no operator capability removed. Props/movers grouped under expansion so the first game arrives sooner.
- Original FBIS vector sport glyphs + text fallbacks, rather than unlicensed league logos or NCAA marks. No approved reusable official league/tour logo asset was established; do not describe these as official marks.
- ATP/WTA presentation selection continues to fetch existing sport=tennis backend. URL tour parameter persists display choice. Source tour conflicts and unknown tours remain unclassified. Explicit doubles are excluded from default ATP/WTA singles selections; unknown formats remain labeled unverified. ITF/Challenger/125 classification comes only from supplied competition fields. No match IDs or market objects change.
- Existing Tennis cards retained inside scoped compact frame, smaller consistent photos, flags, typography, correct competition labels and expandable analytical detail. Model direction, priceboards and existing signal semantics retained.
- Bounded read-only portrait bridge resolves unique exact canonical names and reuses approvedTennisPortraits + existing tennis-portrait route. Existing IDs must agree. No guessed alias, source admission, image caching or database write. Visible source/license credits accompany recovered approved portraits.
- 390/375/430/1280px same-origin live viewport verification page at /board-viewport-check.html. It embeds the actual app, not fabricated examples. It tests Chrome layout at those widths; it is not a claim of physical iPhone/Safari testing.

## Polymarket image audit

Official docs: https://docs.polymarket.us/data-guide/sports-data . Tested public endpoints:

- GET https://gateway.polymarket.us/v1/sports/teams?limit=100&filters.league=atp (HTTP200,100 records)
- Same for wta (HTTP200,100 records)
- Four documented name-filtered team lookups for Daniel Galan, Juan Carlos Prado, Yu-Hsiou Hsu, Keegan Smith (HTTP200, one exact provider record each)
- GET /v1/sports/players?limit=20&filters.name=Keegan%20Smith (HTTP200, empty players array)

**Finding:** `logo`, `longIcon`, `shortIcon` can remain a flag while `longIconDark` / `shortIconDark` is a player photo, designated by `imageDisplayType=IMAGE_DISPLAY_TYPE_HEADSHOT`. 204 total distinct players (104 ATP/100 WTA), 45 headshot-designated candidates (25 ATP/20 WTA). Four named photographs fetched for isolated visual inspection: all HTTP200, 400x400 PNG, ~204–224KB. Provider records bind photos to player IDs 4583/3401/3229/3206. These are photographic headshots, not league artwork; independent canonical ID/rights admission remains required. All new Polymarket portrait public approvals/display counts = **0**.

Polymarket US terms effective Oct23 (https://polymarket.us/tos, linked published document) retain company/third-party image rights and prohibit redistribution absent express license. Public API documentation does not establish a public-web photo license, hotlink grant, proxy grant or R2 caching permission. No new Polymarket image was hotlinked in FBIS, copied to R2, publicly approved or substituted for an approved existing source. This is the exact remaining permission gate.

Archived R2 investigated read-only: market-sources/polymarket-us/ prefixes (raw, receipts, coverage, bootstrap, stream-roster, spill, trades). Bounded oldest receipt sample run-38438876736-1-atpcq-0.json points to a captured atpcq response with zero items and preserved raw reference; not portrait evidence. A sport-specific stream-roster/atp prefix returned no objects. Do not claim exhaustive R2 coverage. Existing global integration retains Gamma event artwork; historical Global audit supplied by owner is not independently reclassified as player portraits in this release.

PRIMARY portrait ledger baseline: 48 APPROVED/PUBLIC_WEB/public_display_allowed=1 records. R2 sample confirms existing Commons assets and license metadata. New board bridge reuses these; does not rebuild portrait infrastructure.

## Verification gates

Local tour/identity/ambiguity tests and build pass. Full npm regression rerun required. After release record actual production SHA/deployment, ATP/WTA counts against the same API response, mobile and desktop rendered checks, overflow/footers/actions, approved portraits and fallback, existing sport cards and final readback in tracking issue. Do not infer completion from build alone.

## Remaining limitations

Polymarket photo reuse needs explicit rights; official league/tour logos need approved display rights/assets. Source competition/format gaps stay unverified. Exact-name misses and ambiguous identities remain silhouettes; no speculative joins. Source timestamps, historical Tennis estimates and all existing wager controls retain their original meanings. No frozen models, DB routing, exchange authorization or paid service changes.
