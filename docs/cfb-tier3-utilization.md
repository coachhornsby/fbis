# CFBD Tier 3 utilization (addendum)

Extends the SDV/CFBD data-ops stack. Does **not** replace REST production jobs or promote challengers.

## Levels

| Level | Role | Examples |
|---|---|---|
| L1 | Approved champion path | overall PPA, gamesPlayed, priors, HFA |
| L2 | Research challengers | pass/rush, success, explosiveness, havoc, rolling, matchups, CORE |
| L3 | Live / specialized | live PBP, in-game state — separate service, never rewrite freezes |

## Modules

- `cfbTier3Entitlements.js` — REST + GraphQL entitlement matrix
- `cfbAdvancedResearchFeatures.js` — rolling windows, matchup vectors, model family plan, GraphQL shadow plan
- `cfbSourceToModelAudit.js` — per-game 15-point consumption audit
- API: `/api/cfb-data-ops?section=tier3`, `/api/cfb-tuesday-readiness` embeds audits

## GraphQL

Transport scaffolded under shared governor. **Zero** production query documents. Shadow-collect and verify billing before retiring any REST path.

## Tuesday priority

L1 repairs and readiness gate ship first. L2/L3 expand under research governance without delaying the Oct 20 board.
