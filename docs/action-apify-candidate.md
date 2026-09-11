# Action Network / Apify — Production Candidate (Shadow)

## Status

**PRODUCTION CANDIDATE / SHADOW ONLY.**

Action/Apify is **not** an authoritative odds provider.

Authoritative production router remains:

`Parlay → TheOdds → SharpAPI → TheRundown → fail closed`

Hard rules (enforced in code + tests):

- Not present in `ODDS_PROVIDER_ORDER`
- `canQualify = false`
- `canAuthorizeWager = false`
- Does not feed CFB-FBIS-v2 projection features
- Closing / evaluation data is never treated as a pregame feature
- No bankroll dollars (units-only product)

Future promotion (`SHADOW → CO_PRIMARY → PRIMARY`) is a **config/policy decision**, not a rewrite.

## Architecture

```
PRODUCTION ROUTER (unchanged)          ACTION/APIFY CANDIDATE (parallel)
Parlay → TheOdds → SharpAPI            Scheduled Collector
       → TheRundown → fail closed               ↓
              │                        Action Actor (Apify)
              └── authoritative                 ↓
                  markets              Raw payload → Normalizer
                                               ↓
                                       Provenance + Observation keys
                                               ↓
                                       Cost ledger + Reliability
                                               ↓
                                       Provider championship
                                               ↓
                                       Promotion readiness scorecard
                                               ↓
                                          NO AUTHORITY YET
```

### Modules

| Module | Role |
| --- | --- |
| `functions/lib/actionApifyCandidateConfig.js` | Plan/profile/cadence config; fail closed on unknown plan |
| `functions/lib/actionApifyCandidate.js` | Matching, books/markets/prices, schema drift, cost helpers, temporal rules |
| `functions/lib/actionApifyCollector.js` | Schedulable collection, overlap/budget/circuit guards, idempotent ingest |
| `functions/lib/actionApifyChampionship.js` | Incumbent comparison + readiness scorecard + $19 sufficiency model |
| `functions/lib/actionApifyShadow.js` | Existing research adapter / Actor runner (unchanged authority) |
| `functions/api/action-apify-collect.js` | Auth-gated plan/execute endpoint for scheduled jobs |
| `migrations/0021_action_apify_candidate.sql` | Additive candidate ops tables |
| `migrations/0022_action_apify_harden.sql` | Durable scheduler lease/circuit + observation enrichment |
| `functions/lib/actionApifyDurableState.js` | D1-backed lease, circuit, MTD spend |
| `functions/lib/actionApifyObservationStore.js` | Full shadow market observation persistence (0020 tables) |
| `functions/lib/actionApifyEvidence.js` | Cold-start health + persisted championship scorecard |

## Hardening (0022)

Production-shadow enablement fixes:

1. **FBIS event matching wired** — live collect loads the canonical `games` slate via `queryGames` and passes `fbisEvents` into the collector. Only EXACT/HIGH matches persist `fbis_event_id`.
2. **Full market persistence** — normalized Action rows write into `shadow_market_observations` / `_books` / `_splits` / `shadow_line_movement` (0020), not just observation keys.
3. **Idempotency split** — run retries share a logical collection key; source-timestamped observations key by event/market/book/sourceObservedAt; later scrapes without source timestamps are temporal resamples (new rows), not false duplicates.
4. **Durable scheduler** — D1 `shadow_candidate_scheduler_state` owns overlap lease + circuit; in-memory guards are a local fast path only.
5. **MTD budget from ledger** — `actual_total_usd` preferred over `estimated_total_usd`; budget blocks never affect incumbent odds.
6. **Cold-safe health / scorecard** — `mode=health` and `mode=scorecard` read D1 evidence; empty in-memory state after cold start still returns prior runs.
7. **Schema drift vs prior** — fingerprints compare to the last INFO/WARN fingerprint before classifying BLOCK.
8. **`gamesExpected` ≠ `maxItems`** — expected slate size comes from FBIS events (or null); a 16-game NFL slate is not partial because `maxItems=200`.
9. **Match denominators** — `actionToFbisMatchRate`, `fbisCoverageRate`, `ambiguousRate` tracked separately.
10. **Promotion thresholds advisory** — sample-size/reliability/cost warn only; no auto PRIMARY; commercial-use review remains required.

## Configuration

| Key | Default | Notes |
| --- | --- | --- |
| `ACTION_APIFY_ENABLED` | `false` | Disables network collection cleanly |
| `ACTION_APIFY_PLAN` | `free` | `free` or `starter` only; unknown → fail closed |
| `ACTION_APIFY_MAX_ITEMS` | plan-aware | Free clamps ≤10; starter uses configured max with safety cap |
| `ACTION_APIFY_MONTHLY_BUDGET_USD` | `19` in starter / `5` in free | Soft guard for candidate runs |
| `ACTION_APIFY_PROFILE_CFB` / `_NFL` / `_MLB` | `BASE` | Collection profile |
| `ACTION_APIFY_COLLECT_MOVEMENT` | `false` | Optional movement block |
| `ACTION_APIFY_COLLECT_MLB_F5` | `false` | Optional First Five |
| `ACTION_APIFY_COLLECT_PROPS` | `false` | Optional player props |
| `ACTION_APIFY_RAW_RETENTION` | `hash` | Prefer hash/redacted snapshot over unbounded raw |
| `APIFY_TOKEN` | unset | Secret store only — never commit/log/client |

Never infer `starter` from token presence alone.

### Plan semantics

**Free**

- `maxItems <= 10`
- research mode
- existing budget guard preserved

**Starter**

- full-slate collection within Actor/provider limits
- safety upper cap (default 200)
- no artificial 10-game clamp

## Collection profiles

| Profile | Contents |
| --- | --- |
| `BASE` | Main/full-game markets, consensus, per-book, splits where available |
| `MOVEMENT` | Includes line movement history |
| `MLB_F5` | First Five markets |
| `PLAYER_PROPS` | Targeted props only |
| `FINAL` | Completed games, closing markets, settlement/research fields |

Lifecycle cadence (`early_slate` / `pregame` / `final_pregame` / `postgame`) selects profile + temporal class:

- `pregame_observation` — never invent timestamps
- `evaluation_close` — postgame/closing only; not a pregame feature

## Scheduling

Use `GET/POST /api/action-apify-collect` with harvest auth.

- `GET ?mode=plan&sport=cfb` — dry-run plan (no Actor spend)
- `GET ?mode=health` — candidate health slice
- `GET ?mode=monthly` — $19 sufficiency scenarios
- `POST` with `execute=1` — run candidate collection when enabled

Scheduler safety:

- overlap protection
- bounded retries / backoff
- max run duration
- per-run + monthly budget guards
- plan-specific row cap
- circuit breaker on repeated Actor failures
- budget block stops Action only — never incumbent production odds

Sports supported now: **CFB / NFL / MLB** (NBA/NCAAB/NHL slots reserved).

## Storage (migration 0021)

Additive tables:

- `shadow_collection_runs`
- `shadow_cost_ledger`
- `shadow_provider_reliability`
- `shadow_schema_fingerprints`
- `shadow_promotion_metrics`
- `shadow_dead_letters`
- `shadow_observation_keys`

Idempotent ingest uses deterministic natural keys around provider/event/market/period/book + source observation / movement timestamp + payload hash.

## Cost accounting

Every run persists ESTIMATED component charges (run start, scoreboard, rows, optional blocks).  
If Actor billing is unavailable, cost basis is labeled **`ESTIMATED`** — never “actual”.

Aggregations: today / 7d / MTD / cost per game / per run / by sport / by profile / projected 30-day.

### Monthly $19 sufficiency

`projectMonthlyStarterSufficiency()` reports scenarios A–G for MLB/NFL/CFB/combined:

- estimated monthly cost
- % of $19 Starter credit
- expected overage (if any)

Does **not** force projections under $19.

## Reliability + schema drift

Reliability ledger: success/failure classes, latency, empty/partial/malformed, unmatched, duplicates, retries, timeouts.

Schema fingerprinting classifies drift:

- `INFO` — new optional fields
- `WARN` — optional structure changes
- `BLOCK` — core identity/price fields missing or incompatible → not promotion-eligible

Candidate failure never marks global production health DOWN.

## Provider championship + readiness scorecard

Compares Action against Parlay / TheOdds / SharpAPI / TheRundown on coverage, agreement, freshness, history, market intelligence, reliability, economics.

Only `EXACT` / `HIGH` event matches participate in comparison metrics. Ambiguous joins are never forced.

Scorecard states include `NOT_READY`, `COLLECTING`, `INSUFFICIENT_SAMPLE`, `READY_FOR_REVIEW`, `BLOCKED_*`, `PRIMARY_CANDIDATE`, `CO_PRIMARY_CANDIDATE`, `SHADOW_ONLY`.

The scorecard is **advisory** and does **not** alter `ODDS_PROVIDER_ORDER`.

## Ops / secrets

### Rotate / install `APIFY_TOKEN`

1. Rotate any token that was ever pasted into chat.
2. Install the new token only via Cloudflare Pages / secret store as `APIFY_TOKEN`.
3. Never put the token in git, D1, client bundles, workflow dispatch inputs, artifacts, or logs.

### Enable free vs starter

```bash
ACTION_APIFY_ENABLED=true
ACTION_APIFY_PLAN=free     # or starter
ACTION_APIFY_MAX_ITEMS=10  # optional; free still clamps
```

### Disable safely

```bash
ACTION_APIFY_ENABLED=false
```

Incumbent production odds collection continues unchanged.

## Health

`/api/health` includes an `actionApify` section (mode/plan/configured/last run/cost/readiness).  
Shadow degradation ≠ production DOWN.

## Tests

Offline only — CI never spends Apify credit:

```bash
node --test test/action-apify-candidate.test.js
# or npm test
```

## Related

- Shadow research adapter: `docs/action-apify-shadow.md`
- Championship research plan: PR #65 / `docs/action-apify-provider-championship.md` (if present)
