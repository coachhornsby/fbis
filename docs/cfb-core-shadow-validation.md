# CFB CORE Shadow Validation (Research-Only)

## Authority

- Challenger: `CFB-CORE-SHADOW-v1`
- Champion remains production authority (`CFB-FBIS-v2` / documented college champion path)
- `canQualify=false`, `canAuthorizeWager=false`, `canInfluenceProduction=false`
- Auto-promote disabled (`CFB-CORE-PROMOTION-GATE-v1`)

## Storage

- Prospective immutable ledger: `TIER3_DB.cfb_core_shadow_predictions`
- Evaluation reports: `TIER3_DB.cfb_core_evaluation_reports`
- Fitted OOS artifacts (only when verified): `TIER3_DB.cfb_core_research_artifacts`
- Large raw archives remain in private R2; migration `0111_cfb_core_shadow_research`

## Jobs (cache-only; no CFBD spend)

1. `cfb-core-shadow-settle` — attach verified finals to frozen rows
2. `cfb-core-shadow-freeze` — insert-or-ignore pregame champion + CORE side-by-side
3. `cfb-core-weekly-evaluation` — walk-forward / limitation report

Scheduled after college-health in `.github/workflows/college.yml`.

## Dashboard

- UI: CFB board + Model Lab (`CfbCoreResearchView`)
- API: `GET /api/cfb-core-research` (read-only, no provider acquisition)

## Temporal integrity

- CORE must be same-season, week-bounded (`throughWeek < gameWeek`), endpoint `/ratings/core`, observed before kickoff
- Current live through-week must not be treated as next-week information
- Missing data is flagged; projections are never invented

## Promotion

Passing research gates only yields `PROMOTION_ELIGIBLE_PENDING_OPERATOR`. Explicit operator authorization is still required. One good week or disagreement alone is never evidence.
