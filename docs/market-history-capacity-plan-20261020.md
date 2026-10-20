# Market-history capacity plan — 2026-10-20

**Contract:** `fbis-market-history-capacity-plan-v1`  
**Status:** Verified against live Cloudflare D1 metrics  
**Can authorize wager:** false

## Verified writer routing

| Store | Size | Live writes |
|---|---:|---|
| `fbis-market-history` (legacy) | 9,999,998,976 B (~100%) | **Frozen** — last `collected_at` `2026-10-20T07:12:07.595Z` |
| `fbis-market-history-2026Q4` | 960,995,328 B (~9.6%) | **Active** — WS + bootstrap; max `collected_at` live |
| `fbis` PRIMARY | 8,113,790,976 B | Not the WS history default (`WS_Q4_DEFAULT`) |

No live writer targets the full legacy market-history database. Q4 is receiving intended live observations (`Polymarket US WebSocket` CURRENT ≈ 98% of rows).

## Measured Q4 growth (2026-10-20)

| Metric | Value |
|---|---:|
| Rows | 279,606 |
| Distinct `observation_key` | 279,606 (0 duplicates) |
| Bytes / observation | ≈ 3,437 |
| Avg raw payload chars | ≈ 1,697 |
| Hourly rows (UTC 12 / 13 / 14 partial) | 91,944 / 137,806 / 49,856 |
| Median rows / hour | 91,944 |
| Peak rows / hour | 137,806 |
| Peak rows / minute | 4,052 |
| Distinct markets / outcomes | 1,575 / 3,150 |

### Time-to-capacity (unbounded ingest, no coalesce)

Remaining ≈ 9.04 GB.

| Scenario | Rows/hr | Hours to 10 GB |
|---|---:|---:|
| Current (partial hour) | ~50k | ~53 h |
| Median | ~92k | ~29 h |
| Peak | ~138k | ~19 h |

**A quarterly partition cannot hold a quarter of observations at this rate.**

### Seven-day hot window (rejected)

At median ingest: `91944 × 24 × 7 × 3437 ≈ 53 GB` — **does not fit** in 10 GB. Legacy 7-day D1 policy is explicitly rejected.

## Sustainable architecture

```
WS tick
  ├─ R2 spill (raw batch) ─────────────── durable full-fidelity evidence
  ├─ latest_market_state (D1 upsert) ──── compact current quotes (~3k rows)
  └─ normalized_market_observations ──── coalesced ledger (60s / priceΔ≥0.001)
         └─ older than hot window ─────── R2 archive → retention gate (no auto-delete)
```

| Control | Value |
|---|---|
| Hot window | Sized from measured median + coalesce (≤ 24 h; see `MARKET_HISTORY_HOT_WINDOW_MS`) |
| Coalesce | 60 s per outcome, or material `contract_price` move ≥ 0.001 |
| Write fail-closed | From **HIGH (85%)** — not only CRITICAL |
| Legacy fallback | Disabled unless `MARKET_HISTORY_ALLOW_LEGACY_WRITE=enabled` |
| New quarterly D1 | **Not authorized** until this plan is proven in production |

Board / CLV / settlement keep:

- Compact latest quotes in D1 for current comparisons
- Bounded recent tick history in D1 for short-horizon analytics
- Full raw history in R2 with SHA-256 manifests before any source retirement

## Operator checklist

1. Confirm legacy last-write remains frozen (no new rows after 07:12Z).
2. Confirm Q4 continues receiving WS CURRENT ticks.
3. Run archive scan (`market-history-archive-scan`) dry-run, then `archiveWrites=true`.
4. Retention-gate delete only after independent R2 restore + explicit authorization.
5. Monitor `/api/storage-capacity` for Q4 percent + `q4Forecast`.
6. Do not open another unbounded partition to “buy time.”

## Relation to sport D1 migration

Sport migration (PRIMARY → per-sport D1) **does not** shrink market-history. Treat capacity recovery for `fbis-market-history` / Q4 as a **separate** track from NFL/CFB shadow population.
