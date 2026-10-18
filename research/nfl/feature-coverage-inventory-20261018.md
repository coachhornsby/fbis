# NFL scoring feature coverage inventory — 2026-10-18

Research inventory only. Does not authorize champion, confidence, or wagering changes.

## Production context

- Displayed research model: `NFL-PRO-v1@v1.2`
- Production champion: `NFL-PRO-v1.1` (unchanged)
- Pregame publications (2026-10-18 slate): 12/12 current-checkpoint freezes on SHA `764a1646`
- Historical ~42% coverage share reflects live nflverse families present vs 12 PRO coverage flags

## Inventory

| Family | Source | Collected | In scoring path | Affects displayed score | Status |
|---|---|---|---|---|---|
| Team EPA / pass / rush | nflverse team week | Yes | Yes | Yes | LIVE |
| Success / early-down | PBP research only | Research | Contract keys null on feed | No | GAP — not mapped into `nflFeatures` |
| Explosives | PBP research only | Research | Null on feed | No | GAP |
| Defensive EPA | nflverse | Yes | Yes | Yes | LIVE |
| QB EPA/CPOE/sack/NGS | nflverse + NGS | Yes | Yes | Yes | LIVE |
| Pressure (defense) | nflverse `def_qb_hits` | Yes | Yes | When opponent allowed present | LIVE |
| Pressure allowed (offense) | opponent `def_qb_hits` / dropbacks | Restored 2026-10-18 | Yes | Yes when blended | RESTORED in this PR |
| Trenches / line yards | None authorized | No | Term null | No | GAP — leave null |
| Special teams | None authorized | No | Term null | No | GAP — leave null |
| HFA / neutral | Constant + schedule | Yes | Yes | Yes | LIVE |
| Rest / travel / TZ | ESPN schedule profile | Yes in D1 | Mapped into `nflFeatures` 2026-10-18 | Yes via `context()` | RESTORED in this PR |
| Altitude adjustment | Feet observed | Yes | No conversion | No | INTENTIONALLY UNMAPPED |
| Weather total factor | `attachWeather` | Yes | Post-score scale | Yes when outdoor | LIVE |
| Weather points in context | — | No | Avoided | No | Avoid double-count |
| Pace | PBP research | Research | Not in PRO | No | DIAGNOSTIC ONLY |
| QB personnel overlay | Official availability | Yes | Shadow only | No | SHADOW |

## Coverage flags (`nflProModel` coverageSummary)

Usually present before this PR: `teamEpa`, `quarterback`, `passMatchup`, `rushMatchup`, `nextGenTracking` (~5/12).

After this PR (when snapshot + schedule rows exist): also `pressure` (when both sides populate) and `context` (when schedule row matches event).

Still missing until authorized collectors exist: `success`, `earlyDown`, `explosives`, `trenches`, `specialTeams`.

## 2026-10-18 follow-up

- Pressure allowed + schedule context restored; live share ~58% before PBP enrich.
- Snapshot workflow now enriches **success / early-down / explosive** from nflverse PBP (`scripts/nfl-enrich-snapshot-pbp-families.py`).
- **Trenches** and **special teams** remain explicitly null (no authorized live source).
- Coverage objective: verified pregame families present — not artificial 100%.

## Smallest safe next work

1. Confirm post-enrich snapshot lifts `success` / `earlyDown` / `explosives` coverage flags in production.
2. Decide authorized trenches / special-teams sources or keep explicit null.
3. Keep QB overlay shadow-gated.
4. Run challenger compare (`scripts/nfl-challenger-compare.mjs`) after each walk-forward refresh.

## Governance

- No champion promotion
- No wager / qualify authority
- Missing families remain null (no fabricated values)
