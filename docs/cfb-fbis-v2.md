# CFB-FBIS-v2 + CFBD endpoint audit

Independent College Football challenger built on CFBD. **Shadow only** — does not replace the production champion until Model Lab promotion gates pass and an operator approves.

## Hard rules

1. No leakage (post-kickoff data never enters a pregame vector)
2. No market data in the independent FBIS score
3. No automatic promotion (`canQualify: false`)
4. Champion remains intact during development
5. Adapt to what CFBD actually returns — do not invent metrics

## Phase 1 — `cfbd-endpoint-audit`

Manual college research job:

```
/api/college?job=cfbd-endpoint-audit
```

Also available via GitHub Actions → FBIS college research → `cfbd-endpoint-audit`.

Safe diagnostics only per endpoint:

`endpoint, httpStatus, ok, rowCount, latencyMs, topLevelType, sampleFieldNames, seasonTested, weekTested, error, classification`

Classifications: `AVAILABLE`, `AVAILABLE-BUT-EMPTY`, `NOT-ENTITLED`, `DEPRECATED`, `INVALID-PARAMETERS`, `AUTH-FAILURE`, `TRANSIENT-FAILURE`.

Empty 200 ≠ unavailable.

Persists to D1 `cfbd_endpoint_audit` + optional R2, uploads a JSON Actions artifact, and prints a feature availability markdown table in the job summary.

## Feature catalog

Canonical dictionary: `functions/lib/cfbdFeatureCatalog.js` (`cfb-feature-catalog-v1`).

Live audit classifications merge into the availability table used by the job summary.

## Temporal feature store

`functions/lib/cfbFeatureStore.js` enforces:

- `feature_as_of_timestamp` ≤ kickoff
- `feature_cutoff_timestamp` ≤ kickoff
- `collection_timestamp` ≤ kickoff
- rolling reconstruction from game rows before kickoff
- full-season aggregates without week/as-of → marked leakage-risk / excluded from temporal eval

## Model architecture (`CFB-FBIS-v2`)

Layers: preseason prior → rolling strength with `n/(n+k)` shrink → matchup (pass/rush/success/explosiveness/havoc/trenches/finishing) → separate QB residual → context (HFA 2.5 preserved) → expected score.

Ablations A–K in `ABLATION_MASKS`. Uncertainty states: LOW / MEDIUM / HIGH.

FCS: equivalent power when available; otherwise `PROVISIONAL` + wider sigma.

## Promotion

Uses existing `PROMOTION_CRITERIA` exactly (`minOosN: 400`, `minSeasons: 3`, `mae_total`, etc.). No auto flip.

## Cost control

Customer page loads never call CFBD. Scheduled refresh + offline backfill only. Design target remains under the CFBD monthly quota.

## Files

- `functions/lib/cfbdEndpointAudit.js`
- `functions/lib/cfbdFeatureCatalog.js`
- `functions/lib/cfbFeatureStore.js`
- `functions/lib/cfbFbisV2.js`
- `data/cfbd/endpoint-probe-plan.js`
- `data/models/cfb-fbis-v2.js`
- `migrations/0017_cfbd_endpoint_audit.sql`
