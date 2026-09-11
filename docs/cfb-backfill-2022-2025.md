# CFB 2022–2025 historical backfill + rolling-origin A–K

**Not fitted for promotion. Not research-ready. `canQualify: false`.**

Strict provenance (`cfb-temporal-audit-v2`). Missing prior / player-role data stays explicit — eligibility was not loosened to inflate row counts.

## Command

```bash
export CFBD_API_KEY=***
CFB_BACKFILL_SEASONS=2022,2023,2024,2025 \
CFB_BACKFILL_MODE=historical \
CFB_ABLATIONS=A,B,C,D,E,F,G,H,I,J,K \
CFB_BACKFILL_PLAYER_ROLES=1 \
node scripts/cfb-feature-backfill.mjs
```

## Snapshot totals

| Season | Games / snapshots | Provenance pass | Prior pass / fail | CORE present+valid |
|--------|-------------------|-----------------|-------------------|--------------------|
| 2022 | 3657 | 724 | 1577 / 5737 | 0 |
| 2023 | 3591 | 1478 | 3014 / 4168 | 0 |
| 2024 | 3745 | 1545 | 3158 / 4332 | 0 |
| 2025 | 3743 | 1559 | 3190 / 4296 | 0 |
| **Total** | **14736** | **5306 (36.0%)** | **10939 / 18533** | **0** |

## Integrity

| Check | Result |
|-------|--------|
| Post-cutoff source rejections | **0** |
| Accepted temporal violations | **0** |
| Request errors | **0** (~312 CFBD calls) |
| CORE week-bounded availability | **0** present — CFBD `/ratings/core` returns only final postseason snapshots; not invented as `targetWeek-1` |

## Rejection reasons (top)

- `feature:missing-source-provenance` — fail-closed priors (mostly non-catalog / FCS–D2 sides)
- `prior:missing-source-provenance` — same
- `feature:season-qb-ppa-unsafe-for-historical` — correctly excluded (not used)

## Missingness (side-level counts)

Prior off/def heavily missing on non-catalog teams; rolling EPA missing early-season / sparse grain; CORE/QB/weather absent under historical freeze as expected.

## Player roles (pre-kickoff `/games/players` only)

| Role | Resolved with player | LOW | MEDIUM | HIGH |
|------|----------------------|-----|--------|------|
| QB1 | 12294 | 17477 | 1881 | 10114 |
| RB1 | 12294 | 18549 | 6583 | 4340 |
| WR1 | 12294 | 19562 | 8719 | 1191 |

Usable player-model sample sizes ≈ **12.3k** named slots per role (of 88.4k total home/away role slots across all games). Ambiguous / week-1 cases stay LOW.

## Rolling-origin A–K (provenance-eligible only, n=5306)

`maeTotal` is essentially tied (~13.60) across A–K with provisional coefficients. Ranking by **maeMargin → |bias| → maeTotal**:

| Ablation | maeMargin | biasMargin | brier | maeTotal |
|----------|-----------|------------|-------|----------|
| **J / K** | **15.75** | **-2.44** | **0.223** | 13.60 |
| B | 15.90 | -4.77 | 0.226 | 13.60 |
| A | 15.94 | -5.25 | 0.227 | 13.60 |
| … | … | … | … | … |

Fold-mean maeMargin (eligible): **J=K best (16.05)**, then B (16.26), A (16.29).

**First decision signal:** base + pass/rush (B) is nearly as good on total error as full K; J/K win on margin calibration/bias. Next coefficient work should calibrate margin/bias before assuming deeper feature stacks help.

## Artifact hashes

See `artifacts/cfb-fbis-v2-backfill-hashes.json` and `data/cfbd/backfills/2022-2025-historical-summary.json`.

## Governance

- `CFB-FBIS-v2` / `CFB-PLAYER-v1`: `canQualify: false`
- Champion `FBIS-v1.4` untouched
- No auto-promotion
