# Action Network via Apify — Shadow Market Intelligence

## Status

**SHADOW RESEARCH ONLY.** This adapter never enters the authoritative production odds router:

`Parlay → TheOdds → SharpAPI → TheRundown → fail closed`

It never grants `canQualify` / `canAuthorizeWager`, and it never feeds CFB-FBIS-v2 projection features.

## Actor

- Apify Actor: `parseforge/action-network-scraper`
- Provider id: `ACTION_APIFY`
- Source class: `SHADOW_MARKET_INTELLIGENCE`
- Schema version: `action-apify-shadow-v1`

## Architecture

```
PRODUCTION ROUTER                    SHADOW INTELLIGENCE
Parlay → TheOdds → SharpAPI          Action Network via Apify
       → TheRundown → fail closed           │
              │                              ▼
              └── authoritative markets    shadow_* tables
                                           comparison reports
```

Implementation: `functions/lib/actionApifyShadow.js`  
Storage: `migrations/0020_action_apify_shadow.sql`  
Offline tests: `test/action-apify-shadow.test.js`  
Manual eval: `scripts/action-apify-shadow-eval.mjs`

## Security

- Secret name: `APIFY_TOKEN` (Cloudflare Pages / local `.env` only)
- Never commit, log, print, or store the token in D1 / artifacts / client JS
- Live runner redacts token material from error details
- CI uses fixtures only — no Apify credit burn in `npm test`

## Free-plan constraints

- ~$5 monthly Apify usage credit
- Free runs return at most **10 games**
- Futures skipped on free plan
- Hard clamp in code: `maxItems <= 10`
- Initial research budget hard stop: **$1.00** estimated Actor spend

## Pricing model (Actor PPE)

| Event | Price |
| --- | --- |
| Run start | $0.054 |
| Scoreboard / league+period | $0.01 |
| Game row | $0.007 |
| Full line movement / game | $0.006 |
| Player props / game | $0.008 |
| Game props / game | $0.004 |
| Game detail / game | $0.005 |
| Weather / league | $0.01 |
| Injuries / league | $0.01 |
| Standings / league | $0.01 |
| Futures row | $0.01 |

Optional blocks stay **off** unless a specific matrix cell needs them.

## Normalized schema (shadow)

Each game row retains identity, provenance, consensus markets, public betting splits, best price, line movement (with Actor-supplied timestamps only), per-book lines, player props, and final results only when legitimately final.

Critical temporal rule:

- `scrapedAt` = collection time
- `observedAt` stays **null** unless the Actor supplies a true source observation timestamp
- Never manufacture a historical `observedAt` from `scrapedAt`
- Never treat closing lines as projection features

## Event matching

Deterministic matcher: league + both teams + kickoff tolerance.  
Ambiguous or missing kickoff → no match. Never force low-confidence joins.

## Shadow comparison

Book/market/period aware (DraftKings spread vs DraftKings spread, etc.).  
Disagreement is **not** auto-labeled as error because observation times may differ.

Metrics include game match rate, exact spread/total agreement, ML abs price diff, missing-on-Action / missing-on-provider counts.

## Live test matrix (manual, budget-capped)

| ID | Goal | Caps | Optional blocks |
| --- | --- | --- | --- |
| A | Current CFB base | ≤10 | none |
| B | Current CFB + movement | ≤5 | line movement |
| C | Historical CFB | ≤10 completed | none |
| D | Current MLB full game | ≤10 | none |
| E | MLB first five | ≤10 | period=firstfive |
| F | MLB player props | ≤3–5 | player props |

Stop when estimated cumulative spend approaches **$1**.

## Running offline

```bash
npm test
# or
node --test test/action-apify-shadow.test.js
```

## Running live shadow eval (owner)

```bash
# APIFY_TOKEN must already be installed in the environment — do not paste into chat/logs.
node scripts/action-apify-shadow-eval.mjs --matrix A
node scripts/action-apify-shadow-eval.mjs --matrix A,B,D --budget 1.0
```

Writes a redacted summary under `artifacts/action-apify-shadow/` (no token).

## Model / qualification safeguards

- CFB-FBIS-v2 coefficients untouched
- `canQualify=false`
- `canAuthorizeWager=false`
- No Action splits / CLV / sharpSide wired into independent projections

## Recommendation workflow

After live matrix cells complete, fill:

1. Capability comparison table (existing FBIS vs Action/Apify)
2. Provider-by-provider KEEP / SHADOW / REPLACE CANDIDATE / REMOVE LATER
3. Whether $19 Apify Starter is justified
4. Exact blockers

Do **not** cancel Parlay / TheOdds / SharpAPI / TheRundown in this phase.
Do **not** promote Action/Apify into the authoritative router.
