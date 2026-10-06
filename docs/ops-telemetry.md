# FBIS operational telemetry contract

The operational control plane is persisted in Cloudflare D1.

Canonical tables:

- `fbis_ops_health` — current per-component state and layered freshness.
- `fbis_watchdog_metrics` — incident detection, repair, verification, repeat count, and MTTR.
- `fbis_run_manifests` — durable run-level evidence.
- `fbis_ops_invariant_checks` — reconciliation checks.

Public read surface: `GET /api/ops-health`.

The response contains:

- `components`: enabled components joined to current health and computed freshness.
- `incidents`: up to 50 recent watchdog incidents.
- `invariants`: manifest and persisted invariant checks.
- `metrics`: 30-day incident/recovery/MTTR rollups.

The hourly `projection-sheet-export.yml` workflow calls the orchestrator operational Sheet sync. That sync mirrors the current control-plane payload into the **Sports Betting Tracker** tab `FBIS Ops Telemetry`.

D1 remains authoritative. The Sheet exists so Bryan, ChatGPT, and Gemini Spark can inspect the same state without using Git as a mutable telemetry database.
