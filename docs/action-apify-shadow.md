# Action Network via Apify — Shadow Market Intelligence

## Status

**SHADOW RESEARCH ONLY.** This adapter never enters the authoritative production odds router:

`Parlay → TheOdds → SharpAPI → TheRundown → fail closed`

It never grants `canQualify` / `canAuthorizeWager`, and it never feeds CFB-FBIS-v2 projection features.

Live matrix **A–F complete** under the **$1** research budget (~**$0.79** estimated Actor PPE). Keep Action/Apify as shadow intelligence; do **not** promote into the production router.

## Actor

- Apify Actor: `parseforge/action-network-scraper`
- Provider id: `ACTION_APIFY`
- Source class: `SHADOW_MARKET_INTELLIGENCE`
- Schema version: `action-apify-shadow-v1`

### Valid Actor input enums (required)

| Field | Allowed values |
| --- | --- |
| `gameStatus` | `any`, `scheduled`, `live`, `complete`, `notStarted` (**not** `final`) |
| `periods` | `event`, `firsthalf`, `secondhalf`, `firstquarter`, `firstfiveinnings` (**not** `firstfive`) |

`buildActorInput` aliases `final`→`complete` and `firstfive`→`firstfiveinnings`. Shadow rows canonicalize F5 period to `firstfive`.

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
Storage: `migrations/0020_action_apify_shadow.sql` (+ `schema.extensions.sql`)  
Offline tests: `test/action-apify-shadow.test.js`  
Manual eval: `scripts/action-apify-shadow-eval.mjs`

## Security

- Secret name: `APIFY_TOKEN` (Cloudflare Pages / local `.env` only)
- Never commit, log, print, or store the token in D1 / artifacts / client JS
- Live runner redacts token material from error details
- CI uses fixtures only — no Apify credit burn in `npm test`
- **Rotate any token that was pasted into chat**; install the replacement only via secret store

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

Line movement: Actor summary lives on `lineMovement`; tick history lives on `lineMovementHistory` (nested `history[]` with `updatedAt`). The normalizer merges both.

## Event matching

Deterministic matcher: league + both teams + kickoff tolerance.  
Ambiguous or missing kickoff → no match. Never force low-confidence joins.

## Shadow comparison

Book/market/period aware (DraftKings spread vs DraftKings spread, etc.).  
Disagreement is **not** auto-labeled as error because observation times may differ.

Metrics include game match rate, exact spread/total agreement, ML abs price diff, missing-on-Action / missing-on-provider counts.

## Live test matrix results

| ID | Goal | Caps | Result | Run | Games | Est. USD | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | Current CFB base | ≤10 | OK | `q6zpWRS6KgFHw1DAb` | 10 | 0.134 | Consensus + ~7 books + splits; finals include scores/closing/ATS |
| B | Current CFB + movement | ≤5 | OK | `qxARQgkXtwCuLJYJl` | 5 | 0.129 | `lineMovementHistory` present (nested ticks + Actor timestamps) |
| C | Historical CFB | ≤10 `gameStatus=complete` | OK | `kBdXkurDQCHeYzYAh` | 10 | 0.134 | 10/10 finals with scores + closing lines; `final` enum rejected (400) |
| D | Current MLB full game | ≤10 `periods=event` | OK | `iaRwIabkYynncx46Y` | 10 | 0.134 | Scheduled slate; consensus + splits + multi-book |
| E | MLB first five | ≤10 `periods=firstfiveinnings` | OK | `kq1E7QfUIjmlAO8uN` | 10 | 0.134 | Period canonicalized to `firstfive`; `firstfive` enum rejected (400) |
| F | MLB player props | ≤4 | OK | `o1RIwhI9uYjcvU1gD` | 4 | 0.124 | Dense props (hundreds/game when enabled) |

**Total estimated PPE: ~$0.79** (under $1 hard stop).  
All normalized rows: `canQualify=false`, `decisionEligible=false`.

## Capability comparison (FBIS production vs Action/Apify shadow)

| Capability | FBIS production path | Action/Apify shadow | Verdict |
| --- | --- | --- | --- |
| Authoritative odds for board/execution | Parlay → TheOdds → SharpAPI → TheRundown | Not wired | Keep production router |
| Multi-book consensus | Provider-dependent | Strong (Consensus + Opening + DK/FD/etc.) | Shadow value-add |
| Public betting splits / money-ticket gaps | Limited / not primary | Strong on live samples | Shadow intelligence |
| Line movement with source timestamps | Limited | Strong when `includeLineMovement` (history ticks) | Shadow intelligence |
| MLB F5 markets | Native strategy support | Available via `firstfiveinnings` | Shadow cross-check |
| Player props | Not primary board path | Very dense when enabled (costly) | Research-only |
| Historical finals / closing / ATS | Settlement / CFBD paths | Usable with `gameStatus=complete` | Shadow / research |
| Free-plan scale | N/A | Max 10 games/run | Not a production odds backbone |
| Latency / reliability for live board | Existing fallbacks | Scrape Actor; PPE cost; free caps | Keep out of router |

## Provider recommendations

| Provider | Recommendation | Why |
| --- | --- | --- |
| Parlay | **KEEP** (primary) | Authoritative when credits available; restore after monthly reset |
| TheOdds | **KEEP** (install key) | Configured=false in production — owner must install rotated key |
| SharpAPI | **KEEP** | Proven live fallback during Parlay exhaustion |
| TheRundown | **KEEP** | Last soft backup before fail-closed |
| Action/Apify (`ACTION_APIFY`) | **SHADOW** | Excellent splits, multi-book, F5, props, closing/ATS research — **not** production odds |
| Replace production with Action/Apify | **NO** | Free-plan 10-game cap, scrape economics, not fail-closed institutional feed |
| $19 Apify Starter | **DEFER** | Not justified solely to replace odds; reconsider only if shadow CLV/splits research needs higher caps |

### Exact blockers to production promotion

1. Free plan hard-caps at 10 games — insufficient for full CFB/MLB boards  
2. Not in fail-closed institutional odds path; scrape Actor ≠ contracted odds API  
3. Observation time discipline: never invent `observedAt` from scrape time  
4. CFB-FBIS-v2 must stay isolated (`canQualify` / `canAuthorize` remain false)  
5. Token hygiene: chat-pasted tokens must be rotated before any shared/prod secret install  

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
node scripts/action-apify-shadow-eval.mjs --matrix C,E --budget 0.45
```

Writes a redacted summary under `artifacts/action-apify-shadow/` (no token; directory is gitignored).

## Model / qualification safeguards

- CFB-FBIS-v2 coefficients untouched
- `canQualify=false`
- `canAuthorizeWager=false`
- No Action splits / CLV / sharpSide wired into independent projections

Do **not** cancel Parlay / TheOdds / SharpAPI / TheRundown in this phase.  
Do **not** promote Action/Apify into the authoritative router.

## Out of scope (not in this PR)

PR #63 intentionally contains **no** production odds-router / Parlay / market-lineage behavior changes.

A residual post-#62 cache-label issue may still exist when a successful SharpAPI (or other backup) cache entry retains `parlayError` and the Parlay cache-read path rewrites `source` back to `parlay-credit-exhausted` while `provider` stays `sharpapi`. PR #62 covers successful fallbacks whose `source` remains a backup label (`sharpapi-soft-backup` + `FALLBACK_PROVIDER`); it does **not** cover that rewrite-poisoned cache-read case. Track that as a **separate narrow follow-up** — do not fold production-path edits into this shadow PR.

## Next research phase

See `docs/action-apify-provider-championship.md` for the evidence-based provider championship plan (coverage, freshness, accuracy, economics, recommendation outcomes). Discovery A–F is complete; promotion remains blocked until that scorecard is produced.
