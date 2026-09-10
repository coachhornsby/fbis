# CFB temporal audit + smoke backfill

**Not fitted. Not research-ready. Not promotion-ready.**

## Purpose

Unblock and validate the 2022–2025 historical dataset **before** fitting CFB-FBIS-v2 / CFB-PLAYER-v1.

## Governance (unchanged)

- `CFB-FBIS-v2` / `CFB-PLAYER-v1`: `canQualify: false`
- No wager authorization
- Market / PrizePicks / NoVig excluded from independent projections
- Champion `FBIS-v1.4` untouched until validation evidence exists
- Additive migrations only

## Historically unsafe endpoints (independent matrix)

Rejected unless reconstructed from pre-kickoff game/play rows:

- `/stats/season/advanced`
- `/ppa/players/season`
- `/player/usage`
- `/stats/player/season`
- `/ppa/teams`

Undated same-season SP/FPI/SRS/Elo: **prior-season freeze only**.

CORE: only when `throughWeek <= week-1` for the prediction cutoff (or prior-season freeze).

## Smoke backfill (required before full 2022–2025)

```bash
export CFBD_API_KEY=***   # never commit
CFB_SMOKE_SEASON=2024 CFB_SMOKE_WEEKS=1,2,3,4 node scripts/cfb-temporal-smoke-backfill.mjs
```

GitHub Actions: workflow `FBIS college research` → job `cfb-temporal-smoke`  
(requires repository secret `CFBD_API_KEY`).

Artifacts:

- `artifacts/cfb-temporal-smoke-report.json`
- `artifacts/cfb-temporal-smoke-provenance-examples.json`
- `artifacts/cfb-temporal-rejected-endpoints.json`
- `artifacts/cfb-temporal-smoke-role-examples.json`

## Full backfill (only after smoke provenance audit passes)

```bash
export CFBD_API_KEY=***
CFB_BACKFILL_SEASONS=2022,2023,2024,2025 CFB_BACKFILL_MODE=historical node scripts/cfb-feature-backfill.mjs
```

Or Actions: `cfb-feature-backfill` with seasons `2022,2023,2024,2025`.

## Smoke results (2024 Weeks 1–4)

Live smoke executed against CFBD (key not stored in repo).

| Metric | Value |
|--------|-------|
| Snapshots | 1101 |
| Prior-season audit OK rate | 100% |
| Provenance examples | 12 checked in under `data/cfbd/audits/` |
| Season QB aggregates in independent matrix | **Rejected** |
| Evaluation lines in independent matrix | **Rejected** |
| Fitted / research-ready / promotion-ready | **false** |

Checked-in samples:

- `data/cfbd/audits/temporal-smoke-2024w1-4-report.json`
- `data/cfbd/audits/temporal-smoke-2024w1-4-provenance.json`
- `data/cfbd/audits/temporal-smoke-2024w1-4-roles.json`
- `data/cfbd/audits/temporal-historically-rejected-endpoints.json`

### Role identity note

Without pre-kickoff player-game reconstruction, Week 1–4 smoke roles correctly resolve to `*_UNCERTAIN` / LOW confidence and widen uncertainty. Do not backfill certainty from season leaders.

### Request estimates

- Smoke (1 season × 4 weeks, game-grain): ~21 path calls (plus prior bundle)
- Full 2022–2025 @ 15 weeks (game-grain minimal): ~172 path calls (estimate; player-game reconstruction adds more)
- Canonical fuller estimate: ~476 (see `estimateRequestCount`)

Customer page fanout: **0**
