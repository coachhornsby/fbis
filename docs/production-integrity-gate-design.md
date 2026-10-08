# FBIS Production Integrity Gate — bounded design, not implemented

## Outcome contract

A successful workflow/HTTP response is not a successful acquisition or publication. The gate evaluates a named production commit, schema fingerprint and evidence cutoff. It is read-only; it never launches acquisition, replays jobs, recovers publication, changes policy or grants model/wager authority. Unknown required evidence prevents HEALTHY.

Each check returns `PASS`, `FAIL`, `UNKNOWN` or `NOT_APPLICABLE`, a stable reason code, source URI/key/query, evidence timestamp, inspection timestamp, expected/actual values, sport/consumer/source scope, and producer SHA. Historical evidence stays historical. Provider billing cannot be inferred from a launch reservation.

```json
{
  "contract": "FBIS_PRODUCTION_INTEGRITY_GATE_V1",
  "checkedAt": "2026-10-08T12:00:00Z",
  "productionSha": "<verified Pages SHA>",
  "mainSha": "<verified main SHA>",
  "schemaFingerprint": "<actual sqlite_master hash>",
  "overall": "BLOCKED",
  "checks": [{
    "id": "action.current-consumer-integrity",
    "scope": {"source": "action", "sport": "nfl", "consumer": "slate"},
    "status": "FAIL",
    "reason": "STALE_SOURCE_USED_AS_CURRENT",
    "evidence": [{"uri": "<exact API + request clock>", "observedAt": "<original source time>", "sha256": "<response checksum>"}],
    "expected": {"currentComparisonAvailable": false},
    "actual": {"currentComparisonAvailable": true},
    "freshnessContractSeconds": 600
  }],
  "sports": {"nfl": {"status": "BLOCKED", "reasons": ["STALE_SOURCE_USED_AS_CURRENT"]}},
  "authority": {"changed": false}
}
```

## Required checks and failure responses

| Check | Required evidence | Failure classification / response |
|---|---|---|
| Acquisition provenance | Source, Actor/task, parent and child run IDs, dataset IDs, origin, query scope, acquisition/source times | Missing/contradictory evidence: UNKNOWN; withhold current data, no guessed linkage |
| Immutable raw capture | Exact R2 key/version/ETag, complete body size and SHA-256, JSON/envelope validity, run/dataset match | RAW_MISSING/BODY_UNVERIFIED: BLOCKED publication; access error is UNKNOWN, not missing data |
| Exact reconciliation | Raw, rejected-by-reason, duplicate identity, accepted unique, persisted matching, missing, unexpected IDs; original normalizer version | IDENTITY_OR_COUNT_MISMATCH: BLOCKED completeness; preserve enriched rows; no offset-only inference |
| Canonical publication | Deterministic identity set, original times/provenance, raw→canonical mapping, final bounded cursor/checkpoint | PUBLICATION_INCOMPLETE: DEGRADED/BLOCKED affected evidence; successful partial workflow is not complete |
| Current market validity | Original capture required; source observation checked when supplied; per-source window, order and future bound | Missing/malformed/future: BLOCKED current use; old valid evidence STALE; no timestamp replacement |
| Consumer integrity | Content-level API assertions for direct fields, derived packets, cached reloads, research classification | STALE_SOURCE_USED_AS_CURRENT: BLOCKED current comparison; independent models/owned sources remain available |
| Paid cost reconciliation | Parent + child costs, currency, billing provenance/date, reservation vs actual, attribution and consumers | COST_UNRECONCILED: UNKNOWN economics; stop paid expansion, retain blocked policy; no made-up historical charge |
| Projection availability | Expected valid canonical events vs published projection objects; model/version, input cutoff and event identity | PROJECTION_MISSING/IDENTITY_MISMATCH: per-sport DEGRADED/BLOCKED; never populate with market-implied substitution |
| Semantic API | Expected events/players/surface/time, unavailable semantics, actual values and freshness; mobile UI where relevant | HTTP 200 alone gives no PASS; content mismatch FAIL, access failure UNKNOWN |
| Release consistency | Main/Pages SHA, clean artifact, deployed schema vs migration manifest, PR checks | SHA_SCHEMA_MISMATCH: STOP release acceptance; no automatic migration/deploy |
| Governance | BLOCKED source policies, reservation unchanged, model registry/threshold/authority invariants | GOVERNANCE_DRIFT: BLOCKED release; alert operator, no silent reset/reopening |

## Aggregation

HEALTHY requires PASS for every required check and no unresolved freshness/resource/economic conflict. BLOCKED covers integrity, identity, governance and unavailable mandatory fresh-source inputs. STALE covers trustworthy old observations only. DEGRADED covers partial optional service while independent capability still works. UNKNOWN covers missing access/provenance. NOT_APPLICABLE needs an explicit dependency declaration; it cannot hide failures. Report source, sport and capability status separately: an independent projection can be healthy while its ACTION comparison is blocked.

Gate responses must include unavailable values as null/absent, exact reason and original timestamps. Do not change existing wager authority. Prevent paid acquisition expansion on cost/provenance failure; do not silently deprive a model of needed fresh evidence. Surface that dependency conflict to the operator.

## Prioritized implementation

1. Read-only SHA/schema/policy checks and semantic temporal assertions for the known NFL/NBA/Tennis/misprices boundaries. Reuse deterministic test fixtures for executable acceptance specifications, but obtain production evidence from actual APIs/rows.
2. Read-only immutable-body manifest and exact normalization identity reconciler. PrizePicks recovery requires this before any publication permission; output INCOMPLETE on missing evidence.
3. Prospective raw→accepted→persisted telemetry and resumable publication checkpoint contract. Implement in a separate authorized change; no historical evidence fabrication.
4. Parent/child provider cost reconciliation and controlled source-restoration gate. Natural future acquisition only after explicit reopening approval; canonical publication and reconciled cost must pass before concurrency expansion.
5. Per-sport dependency aggregation and real mobile content checks. Keep bounded run budgets/cursors, measured D1 CPU/duration and explicit UNKNOWN responses.

## Deployment gates

Gate implementation itself needs a separate reviewed PR and authorization. Start shadow/read-only output; compare results against independent inspections. Do not hook automatic policy changes, model promotions or retries into the gate. After review, release acceptance can consume its report. Alerting or external messages need separate authorization.
