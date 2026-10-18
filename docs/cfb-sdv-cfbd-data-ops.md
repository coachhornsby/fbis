# FBIS — SDV & CFBD Data Operations

Production data-governance for college football sources. Page-visible fields are **not** assumed available to the prediction engine; the utilization matrix and scoring provenance prove consumption.

## Architecture

```
SDV raw archive → SDV validation → canonical feature store
CFBD raw archive → CFBD validation → canonical feature store
Canonical feature store → frozen pregame inputs → CFB-FBIS-v2 champion + research challengers
```

Raw providers are never merged into an undocumented combined table. Conflict resolution uses explicit precedence (champion: CFBD only) — never blind averages of incompatible statistics (e.g. CFBD PPA vs SDV EPA).

## Registries (searchable)

| Registry | Module | Notes |
|---|---|---|
| SDV Source Registry | `functions/lib/cfbSdvSourceRegistry.js` | SportsDataverse releases + PIT fallback; **championConsumes = 0** |
| CFBD Source Registry | `functions/lib/cfbCfbdSourceRegistry.js` | Endpoints + feature catalog; shared CFBD/CBBD quota |
| Source→Model Matrix | `functions/lib/cfbSourceModelMatrix.js` | Per-field utilization; scoring provenance |
| Weekly collection | `functions/lib/cfbWeeklyCollection.js` | Schedule, manifests, alerts (HTTP 200 ≠ complete) |
| Retention | `functions/lib/cfbRetentionPolicy.js` | R2 archives + D1 features; retention gate |
| CORE PIT archive | `functions/lib/cfbCoreArchive.js` | Research-only weekly CORE |

## Champion consumption contract

Fitted **CFB-FBIS-v2** (M\*=A / T\*=A) consumes only:

- `ppaOff` / `ppaDef` (overall PPA → points via `26.5 + ppa*40`)
- `gamesPlayed` (schedule preferred; `coreThroughWeek` fallback flagged)
- `priorOff` / `priorDef` (2025 prior-v1)

Advanced rates, CORE ratings, SDV EPA, and pass/rush PPA splits are collected or shown on pages but **do not** move fitted champion scores until a verified challenger is promoted.

## APIs & UI

- `GET /api/cfb-data-ops` — registries, matrix, collection manifest, CORE readiness, pipeline health, weekly operating report
- System tab → **CFB Data Operations** (`CfbDataOpsView`) — SDV Data / CFBD Data / Pipeline Health

## Storage (migration `0111_cfb_data_ops`)

- `cfb_collection_manifests` — per season/week dataset status + evidence
- `cfb_core_weekly_archive` — weekly PIT CORE (research_only=1)
- `cfb_feature_lineage_receipts` — model-used feature audit receipts

## Weekly operating report

`buildWeeklyOperatingReport({ season, week, manifest, modelConsumption })` reports:

1. What was supposed to arrive (schedule)
2. What actually arrived (status, rows, coverage)
3. What was stored (hashes, batch IDs)
4. What each model consumed (pass scoring provenance for per-matchup proof)

## CORE

Archived on `cfb-current-refresh`. Remains **research-only** until explicit promotion. Do not convert CORE per-~100-play units into scoreboard points without validated transforms. `coreThroughWeek` is never silently equated with verified games played.

## Oklahoma regression

Permanent case in `cfbOklahomaAudit.js` / `test/cfb-data-ops.test.js`: missing gamesPlayed restored 100% prior influence (34.1); repaired path ~30.4; OU ≠ Oklahoma State.
