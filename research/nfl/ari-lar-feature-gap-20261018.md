# ARI@LAR residual feature gap — diagnosis

**Verdict:** source-coverage / team-abbreviation join miss — not cache, not event-join, not a pipeline redesign.

## Evidence

Live `ARI@LAR` (`401873004`) at check time:

| Side | successRate | earlyDownEpa | explosiveRate |
|---|---:|---:|---:|
| AWAY ARI | present | present | present |
| HOME LAR | **null** | **null** | **null** |

Snapshot `byTeam.LAR` lacked PBP family fields and `pbpFamilyStatus`, while `byTeam.ARI` was enriched. Meta claimed `teamsWithPbp: 32` but `fieldsWritten: 186` (= 31 teams × 6 fields).

## Root cause

nflverse play-by-play labels the Rams as `LA`. The feature snapshot keys the Rams as `LAR` (same canon as `functions/lib/nflVerseFeed.js`). The PBP enricher joined on raw `posteam`/`defteam` strings, so LAR never received success / early-down / explosive rates.

## Fix

`scripts/nfl-enrich-snapshot-pbp-families.py` now applies the board canon map (`LA→LAR`, `SD→LAC`, `OAK→LV`, …) before aggregation. Re-enrich yields `fieldsWritten: 192` and numeric LAR rates.

## Non-actions

- No Workers Cache redesign (other 11 games already showed 10/12 coverage).
- No change to publication / model promotion / wager gates.
