# NFL production acceptance — after #1264 + #1265

Verified at 2026-10-18T10:42Z. Live SHA at check: `89a30d17` (main tip after #1265 merge `7039f56f`).

## 1. Checkpoint publication integrity

- Coverage schema: `nfl-publication-coverage-v2`
- Current eligible freezes: **12/12**, `currentCoverageShare: 1`
- Scheduled publish+reconcile run `39120094817`: `coverageShare:1`, `remainingGaps:0`
- Past windows without authentic freezes: listed as `MISSING` with `policy: NEVER_RETROACTIVELY_INVENT` (not backfilled)
- Example: HOU@JAX pubs=`[T6]`, missing=`[INITIAL_WEEKLY,T48,T24]` as MISSING details

## 2. Training dataset R2 archive (full SHA-256)

Workflow: https://github.com/coachhornsby/fbis/actions/runs/39120094710

```
sha256: 6764647923489c6ec91e7996a11c05d44baca9f8d018181c924518385785ed07
bytes: 13145726
objectKey: nfl/training/datasets/67646479…ed07.csv
retrievedBytes: 13145726
retrievedShaMatches: true
```

R2 `fbis-archive` object size matches pin. Manifest at `nfl/training/latest-manifest.json`.

## 3. Feature snapshot (availability ≠ accuracy)

Workflow: https://github.com/coachhornsby/fbis/actions/runs/39120094741

- Snapshot schema: `nflverse-features-v5`
- PBP enrich: 32 teams, 186 fields; `stillNullFamilies: [trenches, specialTeams]`
- ARI sample: successRate / earlyDownEpa / explosiveRate numeric; trenches+ST null

Live board: some games at **0.833** (10/12 families — success/earlyDown/explosives present), some still **0.583** until cache fully converges. Weekly report v3 separates:

| Layer | Status |
|---|---|
| availability | measured (stillMissing includes trenches/ST ± partial PBP) |
| scoreContribution | wired when non-null (`altersDisplayedResearchScoreWhenPresent: true`) |
| accuracyEvidence | **NOT_MEASURED** — no OOS ablation / promotion claim |

## 4. Score audit standard

- Arithmetic: `ARITHMETICALLY_RECONCILED_INPUTS_ATTACHED`
- Independent replay: `NOT_INDEPENDENTLY_REPLAYABLE` (audit v2)
- Report documents: arithmetic OK ≠ independent raw-source PASS

## 5. Challenger compare (pinned)

- n=2176 identical chronological windows
- v1.1 margin MAE 10.1993 vs closing market 9.8543
- `promotionEvidencePass: false` — no unauthorized promotion

## Branch protection / CI

Accepted on `TEST / BUILD` + Cloudflare Pages. Unrelated Workers Builds (`orchestrator`, `market-probe`, `soccer-pitchapi-backfill`) remain red across PRs; merges used admin only when those were the sole failures.

## Next scientific objective

Attack the market margin MAE gap (10.1993 → 9.8543) with chronological OOS ablation of advanced families — do not equate snapshot completeness with predictive improvement.
