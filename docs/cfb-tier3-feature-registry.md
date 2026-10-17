# CFB Tier 3 weekly training — feature registry

Frozen schema version: `cfbd-tier3-weekly-v2026w07`  
Header SHA-256: `62495cd767c21366af0b9f155b6a9e3e2393f47bcf756de9c322a3558e2a2d76`  
Column count: **83** (10 identity meta + 1 opening-spread market reference + **72** advanced features)

Code: `functions/lib/cfbTier3FeatureRegistry.js`  
Ingest: `functions/lib/cfbTier3Weekly.js` → private `TIER3_DB` + R2 `licensed/cfbd/tier3/...`  
Authority: `research_only` — never authorizes wagers or production projection influence.

## Week 7 2026 source (private)

| Field | Value |
|---|---|
| Filename | `training_data_2026_week07.csv` |
| Rows | 59 |
| Distinct teams | 118 |
| Empty cells | 0 |
| File SHA-256 | `6f8f00e0b16742a8c71d7e65ec070b015d8baff15c4bff38536fb57e56118f72` |
| Public git | **Not committed** (proprietary) |

## Temporal integrity

`start_date` is stored as a timezone-unspecified literal. Feature cutoff / provider publish time remain **unverified** (`point_in_time_status=source_feature_cutoff_unverified`) until explicit evidence is attached. Do not invent `as_of` from the week number.

Opening `spread` is market reference only — excluded from feature JSON used by market-independent challengers.

## Identity

Canonical mapping uses `identityFailClosed` + `mapSourceTeam`. Bare `Miami` / `USC` / `State` / `Tech` fail closed.

Week 7 offline reconcile: **58 matched**, **1 partial** (`401858263` Miami vs Florida State — home token `Miami` ambiguous; treat as quarantined until qualified as Miami (FL) with evidence).
