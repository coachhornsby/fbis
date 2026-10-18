# CFB End-to-End Validation

Independent audit of the FBIS college football intelligence pipeline.

**Authority:** validation only. Does not modify the production champion, wager gates, or frozen projections.

## Journey under test

Provider → Collection → Raw archive → Validation → Feature classification → Canonical storage → Model input → Feature contribution → Frozen projection → Final score → Accuracy evaluation.

## API

`GET /api/cfb-e2e-validation` — full report  
Sections: `?section=acquisition|classification|consumption|impact|accuracy|cards|weekly`  
Persist: `?persist=1` writes a row to `cfb_e2e_validation_runs`.

## Weekly job

`cfb-e2e-weekly-validation` — registered in college jobs.  
**Schedule constraint:** after source collection, before pregame freeze.  
Reconciles manifests and D1 coverage independently of collector self-success.

## Migration

`0113_cfb_e2e_validation` — `cfb_e2e_validation_runs` ledger.

## Offline artifact

```bash
node scripts/cfb-e2e-validation-audit.mjs
```

Writes `artifacts/cfb-e2e-validation/FULL-AUDIT.{json,md}`.

## Five essentials

1. Champion-critical datasets verified (or explicit unresolved severity).
2. Classification + retention + Oklahoma identity quarantine.
3. Runtime consumption matches fitted contract (prior + PPA + n + HFA).
4. Feature-family ablations reproducible; unfitted families labeled unproven.
5. Accuracy modes labeled: Oct 17 diagnostic, walk-forward scaffold, prospective shadow.
