# College CFB / CBB research (challenger / shadow)

Versioned CollegeFootballData and CollegeBasketballData research systems. They start as **shadow challengers**. They cannot QUALIFY, LOG, or write strategy tickets. Champion weights, HFA 2.5 / 0, FBIS-HC-v1, and the operator-declared 2026-08-26 7–0 record are unchanged.

## Secrets

Pages secrets: `CFBD_API_KEY` (existing). Optional alias `CBBD_API_KEY` for the same bearer. Never put the value in git, logs, D1, R2, or the React bundle. `.env.example` has empty placeholders only.

## Jobs (`/api/college?job=`)

Authenticated with `HARVEST_SECRET`. Separate Worker invocations (10 ms CPU / 50 subrequests).

- `cfb-reference-backfill` / `cbb-reference-backfill` — manual historical seasons
- `cfb-current-refresh` / `cbb-current-refresh` — incremental current season
- `cfb-postgame-harvest` / `cbb-postgame-harvest` — grade frozen shadow projections
- `cfb-qb-transfer-refresh` — refresh durable transfer-QB identity + prior production history
- `cfbd-endpoint-audit` — read-only CFBD entitlement/schema probe + feature availability table (manual)
- `model-train-validate` — Worker runs shadow-model validation summaries (rolling blocked folds) from frozen predictions; external training remains in GitHub Actions
- `model-promote` — explicit criteria + operator approval; never auto
- `college-health` — quota / storage / key configured (no values)

GitHub workflow `.github/workflows/college.yml` is isolated from collect/harvest.

See `docs/cfb-fbis-v2.md` for the CFB-FBIS-v2 challenger (shadow; does not replace the champion).

## Storage

Compact D1 tables in `migrations/0009_college_research.sql` and transfer-QB history in `migrations/0011_transfer_qb_history.sql`. R2 `ARCHIVE` is optional (`fbis-archive`). Missing R2 does not block operational models.

## CBB score identity

`expected_home_efficiency = home_adj_oe × away_adj_de / national`

`home_points = efficiency × possessions / 100 + HCA/2`

`total = home + away` (the old repo total that ignored opposing defenses is rejected).

Tempo is an arithmetic mean, not an assumed 60/40 split.

## Source roles

CFBD football · CBBD basketball · Torvik optional cached CBB · KenPom optional never required · ESPN identity/live · Pinnacle market/CLV · Heritage executions only · Kalshi sentiment · Pal/Savant MLB-only.
