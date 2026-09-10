# CFB temporal audit + smoke backfill

**Not fitted. Not research-ready. Not promotion-ready.**

## Purpose

Unblock and validate the 2022–2025 historical dataset **before** fitting CFB-FBIS-v2 / CFB-PLAYER-v1.

Audit version: `cfb-temporal-audit-v2` — a PASS proves **actual source eligibility**, not inferred maximum eligibility.

## Governance (unchanged)

- `CFB-FBIS-v2` / `CFB-PLAYER-v1`: `canQualify: false`
- No wager authorization
- Market / PrizePicks / NoVig excluded from independent projections
- Champion `FBIS-v1.4` untouched until validation evidence exists
- Additive migrations only

## Provenance rules (v2)

1. **Priors fail closed** — missing `priorCatalogEntry` or missing `sourceSeason` → `ok:false`, `sourceSeason:null`, reason `missing-source-provenance`. Never default to `expectedPriorSeason`.
2. **Source observations** — reconstructed features carry source game ID, kickoff, season, week, endpoint, target kickoff, and prediction cutoff. Every source kickoff must be strictly before the target kickoff (week labels alone are not proof).
3. **Allowance vs consumption** — store separately: `latestAllowedWeek`, `actualSourceWeeks`, CORE `throughWeek`, `sourceGameIds`. Do not set `sourceWeek = targetWeek - 1` unless that week was actually consumed.
4. **CORE** — use the actual row’s `year` / `throughWeek` / `throughSeasonType`. Pass only when `throughWeek <= latestAllowedWeek` (`targetWeek - 1`). Never substitute `targetWeek - 1` as the retrieved row’s throughWeek.
5. **Cutoff gate alone is insufficient** — `assertPregameTemporalIntegrity` only proves constructed timestamps precede kickoff. Historical PASS requires the observation provenance above.

## Historically unsafe endpoints (independent matrix)

Rejected unless reconstructed from pre-kickoff game/play rows:

- `/stats/season/advanced`
- `/ppa/players/season`
- `/player/usage`
- `/stats/player/season`
- `/ppa/teams`

Undated same-season SP/FPI/SRS/Elo: **prior-season freeze only**.

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
- `artifacts/cfb-temporal-smoke-role-uncertain.json`
- `artifacts/cfb-temporal-smoke-role-reconstructed.json`
- `artifacts/cfb-temporal-rejected-endpoints.json`

## Full backfill (only after hardened smoke provenance audit passes)

```bash
export CFBD_API_KEY=***
CFB_BACKFILL_SEASONS=2022,2023,2024,2025 CFB_BACKFILL_MODE=historical node scripts/cfb-feature-backfill.mjs
```

Or Actions: `cfb-feature-backfill` with seasons `2022,2023,2024,2025`.

**Do not run full backfill until corrected 2024 Weeks 1–4 smoke proves source-level temporal integrity.** Next step after that: complete 2022–2025 backfill → rolling-origin A–K fitting.

## Smoke results (2024 Weeks 1–4)

Hardened smoke (`cfb-temporal-audit-v2`) executed against CFBD (key not stored in repo).

| Metric | Value |
|--------|-------|
| Snapshots | 1101 |
| Actual provenance pass rate | 41.5% (457/1101) |
| Prior provenance pass / fail | 965 / 1237 |
| Missing prior provenance | 1237 |
| Post-cutoff source rejections | 0 |
| CORE cutoff rejections | 0 |
| CORE present + valid | 0 |
| Season QB aggregates in independent matrix | **Rejected** |
| Evaluation lines in independent matrix | **Rejected** |
| Fitted / research-ready / promotion-ready | **false** |

Notes:

- Prior failures are almost entirely `missing-source-provenance` (FCS/D2 and teams absent from the frozen prior catalog) — fail closed, not defaulted.
- CFBD `/ratings/core?year=2024` currently returns only a final `throughSeasonType=postseason` snapshot; regular-season week-bounded CORE is therefore correctly absent (`corePresentOk=0`), not invented as `targetWeek-1`.
- Player-role slice flattens nested `/games/players` and resolves QB1/RB1/WR1 from **pre-kickoff** rows only.

### Representative reconstructed player-role examples

- **South Florida @ Alabama** (W2) home.QB1: Jalen Milroe — priorRows=1, conf=0.56 (MEDIUM), method=`prior-games+usage`, sources=['401628319']
- **South Florida @ Alabama** (W2) home.RB1: None — priorRows=0, conf=0.00 (LOW), method=`uncertain`, sources=[]
- **South Florida @ Alabama** (W2) home.WR1: None — priorRows=0, conf=0.00 (LOW), method=`uncertain`, sources=[]
- **South Florida @ Alabama** (W2) away.QB1: Byrum Brown — priorRows=1, conf=0.87 (HIGH), method=`prior-games+usage`, sources=['401636363']
- **South Florida @ Alabama** (W2) away.RB1: None — priorRows=0, conf=0.00 (LOW), method=`uncertain`, sources=[]
- **South Florida @ Alabama** (W2) away.WR1: None — priorRows=0, conf=0.00 (LOW), method=`uncertain`, sources=[]

Checked-in samples:

- `data/cfbd/audits/temporal-smoke-2024w1-4-report.json`
- `data/cfbd/audits/temporal-smoke-2024w1-4-provenance.json`
- `data/cfbd/audits/temporal-smoke-2024w1-4-roles.json`
- `data/cfbd/audits/temporal-smoke-2024w1-4-roles-uncertain.json`
- `data/cfbd/audits/temporal-historically-rejected-endpoints.json`


## Adversarial tests

`test/cfb-temporal-audit.test.js` covers:

- A post-kickoff source rejected despite earlier week label
- B missing prior `sourceSeason` fails closed
- C current-season prior fails when prior freeze required
- D CORE `throughWeek >= targetWeek` fails
- E CORE with actual `throughWeek <= targetWeek-1` passes
- F clean rolling pre-kickoff sources pass
- G one contaminated source fails reconstructed provenance
- H evaluation lines cannot enter independent features
