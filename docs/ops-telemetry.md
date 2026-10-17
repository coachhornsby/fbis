# FBIS operational telemetry contract

The operational control plane is persisted in Cloudflare D1. **New writes prefer `OPERATIONS_DB`** (`fbis-operations-20261017`) when bound; primary D1 is fallback only. See `docs/database-ownership-v1.md`.

Canonical tables (operations-owned):

- `fbis_ops_health` — current per-component state and layered freshness.
- `fbis_watchdog_metrics` — incident detection, repair, verification, repeat count, and MTTR.
- `fbis_run_manifests` — durable run-level evidence.
- `fbis_ops_invariant_checks` — reconciliation checks.
- `fbis_capacity_measurements` — 80/85/90% capacity alert evidence.
- `fbis_retention_release_gates` — retention blocked unless verified recovery copies exist.
- `fbis_pipeline_validation_runs` — cross-sport pipeline validation receipts.
- `fbis_d1_performance_findings` — expensive-query / index / redundant-write findings.

Bootstrap schema: `sql/shards/operations-v1.sql`.

Public read surface: `GET /api/ops-health`.

The response contains:

- `components`: enabled components joined to current health and computed freshness.
- `incidents`: up to 50 recent watchdog incidents.
- `invariants`: manifest and persisted invariant checks.
- `metrics`: 30-day incident/recovery/MTTR rollups.
- `operationsDbPreferred`: true when the live control plane is reading `OPERATIONS_DB`.

The hourly `projection-sheet-export.yml` workflow calls the orchestrator operational Sheet sync. That sync mirrors the current control-plane payload into the **Sports Betting Tracker** tab `FBIS Ops Telemetry`.

Operations D1 remains authoritative for control-plane telemetry. Product facts stay on primary. The Sheet exists so Bryan, ChatGPT, and Gemini Spark can inspect the same state without using Git as a mutable telemetry database.
