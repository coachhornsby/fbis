# Gap follow-up (post explore agent)

The [Explore remaining gaps](bc-538c9ed2-33c8-56ea-9a2a-949221c75cc9) report was largely **stale** relative to `cursor/fbis-manual-complete-312d`.

## Already implemented (report said missing)

| Area | Status on branch |
|---|---|
| `EXPECTED_MIGRATION` | `0025_manual_completion_contracts` |
| `featureRegistry.js` / PURE contamination | Present + tested |
| Probability provenance / authority | Present + tested |
| `decisionAuthority.js` exported | Present; now wired into `qualificationIntegrity` |
| Publication ledger beyond published_projections | Migration 0025 + `publicationLedger.js` |
| DQ severity enum | `INFO` / `WARNING` / `QUALIFICATION_BLOCK` / `MODEL_BLOCK` |
| CBB / NFL PURE challengers | Research scaffolds present |
| NBA / NHL research architectures | Provider-gated stubs present |
| ACTION derivatives (CLV / movement / shopping) | `actionMarketDerivatives.js` |

## Follow-ups completed after the report

1. **Wire decision authority into product qualification** — `functions/lib/slateEngine.js` uses `marketImpliedAuthority` + DQ gates.
2. **Data Health no longer hardcodes `OK`** — derives `qualityStatus` from commercial blocks + provider health.
3. **UI runtime fallback** — App / ChallengerSelect default to `FBIS-v1.4` (historical stamps untouched).
4. **MLB starter flag codes** — preserve `missing_home_sp` / `missing_away_sp` for callers.

## Intentionally unchanged

- **Heritage / track same-origin writes** — covered by existing security tests; cross-origin still requires secret. Fail-closed for missing harvest/strategy secrets remains.
- **Historical `FBIS-v1.3` comments / stamped rows** — must not be rewritten.

## Still legitimate non-IMPLEMENTED

- `OOS_DATA_PENDING` — CBB/NFL PURE graded walk-forward N
- `PROVIDER_OR_LICENSE_BLOCKED` — NBA/NHL licensed feeds
- `OPERATOR_PROMOTION_REQUIRED` — challenger → champion
