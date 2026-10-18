# FBIS NFL — Acceptance after #1264 / #1265 (2026-10-18)

## Verdict

**Infrastructure acceptance criteria met** for checkpoint reconcile, durable training archive (full SHA-256), feature availability plumbing, audit standard separation, and challenger pin. **Predictive improvement remains unproven** — next work is scientific OOS ablation against the market MAE gap.

## Evidence

| Criterion | Result |
|---|---|
| Current-checkpoint publications | 12/12 (`currentCoverageShare: 1`) |
| Missed past windows | `MISSING` + `NEVER_RETROACTIVELY_INVENT` (coverage v2) |
| Scheduled publish reconcile | run `39120094817` — gaps 0 |
| Training R2 archive | SHA `67646479…ed07` upload + retrieve match (`retrievedShaMatches: true`) |
| Snapshot PBP families | v5 snapshot; success / early-down / explosive present; trenches+ST null |
| Weekly report | `nfl-weekly-research-report-v3` with `featureImpact` layers |
| Score audit | Arithmetic reconciled; independent replay `NOT_INDEPENDENTLY_REPLAYABLE` |
| Challengers | n=2176 identical windows; `promotionEvidencePass: false` |
| Champion / wager authority | unchanged |

## Feature layers (do not conflate)

1. **Availability** — snapshot completeness (11/12 games at 10/12 families; ARI@LAR still 7/12 at check; trenches+ST null by design).
2. **Score contribution** — when non-null, success/earlyDown/explosives enter displayed research score math (wiring only).
3. **Accuracy evidence** — `NOT_MEASURED`. No promotion.

## Market gap (next objective)

| Model | n | Margin MAE |
|---|---:|---:|
| NFL-PRO-v1.1 | 2176 | 10.1993 |
| Closing market | 2176 | **9.8543** |

Attack this gap with chronological OOS family ablation — not by treating richer snapshots as proof of lift.

## Merges

- #1264 `7e7f18b9` — scheduler, archive API, audit v2, enricher, challenger compare
- #1265 `7039f56f` — cache v5, archive wait/retry, MISSING ledger, report v3
