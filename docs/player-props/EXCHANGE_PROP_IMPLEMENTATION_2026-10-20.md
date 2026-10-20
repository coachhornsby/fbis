# Exchange player props: implementation and remaining delivery gates

Status: draft foundation; not a production-complete replacement.
Initial base: d33a7bcbb169f4991ab06ab93d8d80afe486d04d. Integrated concurrent main 58207e46a53ad42104c1ce82d72ad6f173f964a7 before final verification.

## Inspected current state

PR #1347 was open and draft at inspection, head a77b4229999d99ae0f2e2b9042559cf779f9dc3e. Its Q4-forwarding and market-delivery work is owned there. This branch does not duplicate those changes or alter board health, bindings, storage authority, collectors, execution or database writes.

Production GET /api/today?sport=nhl at generatedAt 2026-10-20T13:34:32.076Z reported 11 games, 11 projections, zero usable markets and DEGRADED health. This proves neither exchange prop coverage nor contract executability.

The uploaded archive contains older R/Python models, historical NBA gamelogs/prop files, baseball data and a pre-React app. It is background research, not current production code or current market evidence. Credentials and environment files were not opened or imported.

NFL-PLAYER-PROJ-v3.1 validation includes 7,762 predictions per configuration and 74.66% statistical-role accuracy. Its artifact explicitly validates projection-number accuracy rather than pick'em ROI. It does not establish exchange threshold calibration or wager-grade readiness.

## Implemented

- New read-only /api/exchange-player-props reads bound market-history stores (Q4 first) and PRIMARY with bounded queries. Read failures and truncated scans produce COVERAGE UNKNOWN, not a false absence claim.
- Provider-neutral contract adapter retains event/player/provider IDs, sport/stat/period/threshold/side, quote clocks, purchase ask, depth and settlement terms.
- Explicit exact identity and settlement evidence is required. Name-only matches, stale/future clocks, bids, last trades, midpoint prices, closed quotes and absent depth cannot populate current market cards.
- Independent projections, calibration, fees and expected return remain unavailable until separately verified. No market payload becomes an independent model prediction. No qualification or execution authority is granted.
- Active Player Props route and top-board section use the new exchange-only panel. The premium card preserves player images, team theme and LAST 5 bars. Legacy card import remains a compatibility re-export.
- Responsive desktop grid reaches five columns at 1,600px. Stronger borders, provider threshold labels, accessible filters and research buttons are included.
- Workspace has overview, historical performance, matchup, market comparison, model research and results sections. Missing integrations are explicitly labeled, not simulated.
- Game-expanded props retain independent projection-only rows without presenting legacy thresholds as current exchange prices.
- History helper excludes missing/DNP/canceled values, deduplicates games, sorts chronologically and retains actual zero. NFL fallback no longer converts absent stats to zero.
- Canonical exchange player histories stay withheld unless the detail response confirms the canonical player ID. Existing name-only history APIs cannot silently satisfy that identity requirement.
- Historical tables, wagers, observations and provider-specific endpoints are preserved. The old tracked-card component no longer appears on the active route.

## Required collector evidence (NOT YET PRODUCED)

The new normalized adapter expects raw_payload_json.playerPropIdentity with verified=true and exact canonicalEventId, canonicalPlayerId, providerEventId, providerPlayerId, contractId, stat, period, side, threshold and eventStart matching the ledger row, plus settlementVerified=true and nonempty settlementTerms. Quote payloads require bestAsk, askSize, quoteSide, priceSemantics=purchase_ask and marketState=OPEN.

This is a new adapter interface, not a claim that existing collectors emit these fields. Production collectors must validate and write this evidence through their existing authorized ingestion path before this API will deliver verified props. Current Kalshi classification explicitly leaves athlete/stat/threshold/settlement identity unverified. No fabricated evidence has been inserted.

## Coverage and acceptance status

- Live verified player-prop cards delivered by this change: none; branch not deployed.
- All 11 sports are represented in the coverage interface, not certified as exchange-covered or model-ready.
- No independent sport/stat model is joined to exchange contracts yet.
- LAST 5 filtering/ordering/zero handling has regression coverage. Live canonical-ID history acceptance is pending.
- Research workspace shell is implemented. Actual advanced research integrations are pending.
- No production deployment SHA exists for this branch.
- No live visual acceptance or per-sport contract walkthrough has passed.

## Verification

- Combined npm test after integrating newer main: 2,033 passed, zero failed (including 18 new tests).
- New exchange contract/history/API tests: 18 passed, zero failed; included in npm test.
- Vite production build passed.
- git diff --check passed.
- Full live coverage, provider execution-price evidence and rendered-card verification remain release blockers.

## Before merge/deploy

1. Integrate PR #1347 and verify game-board Q4 delivery and truthful source/quote/qualification counts in production.
2. Extend the actual Kalshi and Polymarket collectors to supply audited player/event/stat/settlement mappings and purchase asks with depth and clocks. Preserve provider-specific semantics.
3. Join frozen independent projections by canonical event/player/stat/period; attach versions and validation without inheriting sportsbook economics.
4. Map canonical player IDs to verified historical source IDs. Remove fuzzy/name-only history fallback from the exchange path.
5. Deliver actual last 5/10, season splits, matchup inputs, calibration evidence, fee calculations and outcome grading through the research workspace.
6. Verify real upcoming provider contracts and UI rendering per sport. Use MARKET UNAVAILABLE only after successful relevant reads; do not fabricate cards.
7. Complete CI, preview UI, full regression and production acceptance before replacing the current experience.

Remaining multi-sport models, expanded research, settlement/learning and confidence ranking are unfinished. This branch must not be described as the requested end-to-end system.
