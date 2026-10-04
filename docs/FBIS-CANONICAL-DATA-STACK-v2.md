# FBIS Canonical Data Stack v2

**Status:** Production governance contract  
**Purpose:** maximize independent information coverage without duplicate facts, duplicate API spend, or double-counted model features.

## Core rule

FBIS stores one canonical observation per fact, entity, point-in-time cutoff, and upstream lineage. Multiple transports that expose the same upstream provider are aliases, not independent evidence.

SportsDataverse is therefore an acquisition/catalog layer, not a new source authority when it wraps CFBD, ESPN, nflverse, MLB Stats, Statcast, NBA/WNBA Stats, NHL APIs, or The Odds API.

## Source decisions

| Sport | SportsDataverse family | FBIS decision |
|---|---|---|
| NFL | Next Gen Stats | ADD as incremental tracking/features |
| NFL | nflverse | SKIP duplicate; current direct nflverse remains authority |
| CFB | CFBD PBP | SKIP duplicate; current direct CFBD remains authority |
| CFB | NCAA PBP/box | ADD incremental historical/validation family |
| CBB | NCAA PBP/lineups/stints | ADD incremental historical family |
| CBB | ESPN | SKIP duplicate where current ESPN already supplies the fact |
| MLB | MLB Stats API | SKIP duplicate |
| MLB | Statcast | SKIP duplicate |
| NHL | NHL modern game feed | ADD |
| NHL | NHL EDGE | ADD tracking family |
| WNBA | WNBA Stats | ADD |
| NBA | NBA Stats | LICENSE_REVIEW before production dependency |
| Soccer | ESPN league surfaces | ADD only for fields/leagues absent from current canonical store |
| All | The Odds API / oddsapiR | SKIP as new live provider; current The Odds API route remains authority |

## Required observation identity

Every canonical observation must be attributable to:

- canonical feature/field key
- canonical event/player/team identity
- value
- upstream lineage
- transport/provider
- observed/retrieved timestamp
- data-through/effective timestamp
- snapshot/model-input version where applicable

## Deduplication

`dedupeCanonicalObservations()` collapses observations only when canonical fact + entity + point-in-time cutoff + upstream lineage are identical. Independent upstream lineages remain separate so FBIS can measure disagreement and use them as validation/fallback evidence.

## Runtime policy

1. Direct existing provider remains preferred when healthy and already implemented.
2. A SportsDataverse transport may fill a missing family, improve historical depth, or act as a fallback.
3. A wrapper around an existing provider cannot create a second model feature from the same fact.
4. Market data stays outside PURE model inputs.
5. Commercial/license status in the canonical source registry remains binding.
6. Historical model rows must still satisfy the FBIS point-in-time/provenance standard.
7. Expensive historical acquisition publishes frozen append-only snapshots; model experiments consume pinned snapshots.

## Incremental priorities

1. NFL Next Gen Stats for NFL-PRO research.
2. CFB NCAA data missing from the current CFBD feature store.
3. CBB NCAA PBP/lineup/stint history for the independent CBB model.
4. NHL game-feed + EDGE tracking.
5. WNBA Stats.
6. Soccer fields/leagues absent from current FBIS storage.

No item above is automatically a production model feature. It must pass temporal integrity, coverage, model ablation/walk-forward validation, and the existing promotion policy.
