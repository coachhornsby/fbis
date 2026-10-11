# FBIS Gemini / Spark Operating Contract

This repository is operated jointly by Bryan, ChatGPT, and Gemini Spark.

## Required read order before operational work

1. Read `https://fbis-myz.pages.dev/api/ops-health`.
   - Cloudflare D1 is the canonical machine state.
   - `components` is the current component health/freshness view.
   - `incidents` is the recent watchdog incident/recovery ledger.
   - `metrics` contains 30-day incident counts and MTTR.
2. Read the **Sports Betting Tracker** Google Sheet:
   - spreadsheet ID: `1B1IVONVvmP50JPCqb64fzEsSaTv6AuHQ04YqEzBhjAo`
   - `FBIS Ops Telemetry`: hourly human-readable mirror of D1 ops health + watchdog metrics.
   - `FBIS Incident Ledger`: shared incident ownership, repair state, validation evidence, and resolution.
   - `FBIS Operator Handoff`: asynchronous ChatGPT ↔ Gemini Spark handoff queue.
3. Read the relevant GitHub workflow/run/commit evidence before changing code.

## Source-of-truth rules

- **Live operational telemetry:** Cloudflare D1 / `/api/ops-health`.
- **Cross-operator incident coordination:** `FBIS Incident Ledger`.
- **Operator handoffs:** `FBIS Operator Handoff`.
- **Code/configuration contracts:** Git main.
- The Google Sheet is a mirror and coordination surface. Do not treat Sheet freshness as stronger evidence than D1.
- Do not commit live telemetry snapshots to Git. Git stores the contract; D1 stores changing state.

## Before starting a repair

- Check `FBIS Incident Ledger` for an existing incident.
- If one exists, update/claim that row instead of creating a duplicate repair.
- Check `FBIS Operator Handoff` for a pending handoff.
- Check `/api/ops-health` for current severity, freshness layers, incident fingerprint, and MTTR/recovery state.
- Never infer production health from a green GitHub workflow alone.

## Validation standard

A repair is not resolved until production evidence supports it. For telemetry incidents, require the relevant combination of:

- D1 health row written;
- watchdog incident row written;
- workflow/source/database/published freshness populated where applicable;
- repair verification timestamp;
- MTTR populated for a repaired incident;
- production deployment SHA confirmed;
- shared Sheet mirror updated by the hourly operational sync.

## Paid acquisition guard

Never launch duplicate paid ACTION or PrizePicks acquisition solely to validate telemetry. Reuse existing provider runs and D1 state unless the paid-run policy explicitly permits another acquisition.


## Mandatory two-agent repair and independent verification protocol

FBIS must operate as a **repairer/verifier pair**, not two independent surveillance reports. The operator who performs a repair must never certify their own repair as resolved.

### Default roles and rotation
- **ChatGPT CI Auto-Repair = IMPLEMENTER** for operational/software defects: triage, reproduce, implement the smallest correct fix, test, run exact-head CI, deploy only within the existing authority, and collect production evidence.
- **Gemini Spark = INDEPENDENT VERIFIER** for ChatGPT-owned fixes: challenge the root-cause diagnosis and independently inspect the actual change, tests, deployment, data-plane effects, and failure recurrence.
- If Gemini is explicitly assigned a fix, ChatGPT becomes the **INDEPENDENT VERIFIER**; the same person/agent cannot hold both roles for one repair.
- Both can detect incidents. Only one operator is the active implementer. Do not duplicate branches, PRs, paid acquisitions, backfills, or migrations.
- If a required verifier is unavailable, mark VALIDATING / AWAITING_INDEPENDENT_VERIFICATION rather than RESOLVED. Do not fabricate a second-party approval.

### Shared ledger lifecycle
Before each pass, read live GitHub/Cloudflare state, \`FBIS Incident Ledger\` and \`FBIS Operator Handoff\`. Reuse the stable incident ID. Respect existing validation-backed Status values in the sheet; put substate in Action Taken / Next Action if needed.

1. **INVESTIGATING** — identify failure fingerprint and current impact; record evidence and assign **implementer** and **independent verifier**.
2. **REPAIRING** — implementer records the root-cause hypothesis, bounded fix, commit/PR, regression tests, and applicable production safety/approval gates.
3. **VALIDATING** — after code is merged/deployed (only when otherwise authorized), implementer submits an immutable evidence package to verifier via a handoff. Do not equate green CI with working production.
4. **RESOLVED** — permitted only once the *other* agent explicitly attests **FIX_PRESENT** and **FIX_CORRECT_AND_OPERABLE**, with run IDs, SHAs, timestamps, data-plane evidence and absence of identified regressions.
5. **REJECTED / BLOCKED** — use sheet-compatible incident Status and explicitly record verification rejection/blocker in narrative. Reassign the same incident to the implementer to address failed checks; do not close, conceal failures or start a competing repair.

### Independent verifier checklist — two required proofs
**Proof 1: Fix actually applied.** Compare the pre-fix and exact repair diff; verify required tests and checks on the repair SHA, PR merge state and production deployment SHA. If the fix involves a workflow, identify the actual subsequent workflow/job execution. If a migration/import, verify the intended live D1 schema/data and authority gate. If archive/ingestion, verify actual R2/D1 objects and timestamps. A PR existing or a workflow succeeding is insufficient.

**Proof 2: Fix is right and operational.** Independently assess whether the change treats the real logged root cause, reproduces the old failure with a regression test that fails before and passes after, preserves safety invariants, and repairs the full provider -> ingest -> persistence -> API/board -> grading chain affected. Check representative production records and a real execution after deployment; reject empty, stale, silently partial, post-event-contaminated or merely synthetic success. Audit side effects, regression risks, time/identity/source provenance, recovery, rollback, and cost.

The verifier must write **APPROVED** or **REJECTED** with exact evidence and reasons to the existing incident ledger + handoff. Only verified fixes may be counted as autonomous successful repairs. Unknown or inaccessible proof is **NOT VERIFIED**.

### Reciprocal accountability and escalation
- Implementer owns response and correction of every REJECTED finding. Verifier owns timely, substantive evidence-backed review. Neither may self-acknowledge the other's assignment.
- On each regular run, inspect unresolved handoffs waiting on the other agent; mark overdue if not acknowledged within two eligible cycles or not substantiated within four hours for active critical incidents. Avoid repeatedly creating duplicate messages.
- If a verifier rejects the same root-cause attempt twice or disagreement persists, report both evidence sets and exact approval decision to Bryan. Do not hide uncertainty or unilaterally mark resolved.
- Reopen a RESOLVED incident on a genuinely recurring failure with the same fingerprint, retaining previous approval and repair evidence.
- Periodically report implementer repair throughput, verified/rejected fix count, recurrence, time-to-fix, time-to-verify, and handoff backlog. Track separately from model efficacy.

### Safety and economic governance
No automated model promotion, wager authorization, altered frozen PIT evidence, destructive migration, historical deletion, paid upgrade, or duplicate paid provider run. Preserve the existing review, CI and operator-approval gates. Monitor cost of the watchdog itself; prefer bounded reads and live evidence over repeated full replays.


## Required shared systems map and cross-scheduler awareness

Read [the shared agent/scheduler/sport operating map](docs/ops/agent-schedules-and-sport-scope.md) before repair, verification, scheduling, paid acquisition, database/schema write or cross-sport shared-platform change. The map records verified scheduling planes, domain boundaries and currently UNKNOWN agent timing. It does not supersede current provider/runtime state.

- Before every mutation, discover live schedules and in-flight jobs in **GitHub Actions**, **Cloudflare Worker crons**, **ChatGPT task manager**, and **Gemini Spark's own automation platform**, to the extent actually accessible. Do not guess or pretend cross-platform schedule access; publish UNKNOWN if inaccessible.
- Maintain a live **FBIS Agent Schedule Registry** in Sports Betting Tracker containing owner, cadence, timezone, next/last execution when known, trigger/backup, resource read/write sets, concurrency policy, idempotency keys and spend guard. Any schedule mutation requires collision analysis and separately authorized CI/deploy.
- A row in a Google Sheet is *advisory*, not a distributed lock. Do not run overlapping writes to shared D1/R2/Sheet/provider resources without atomic resource claim/fencing or coordination proof. Distinct schedules alone are not enough.
- Sport ownership is logical: each bucket has independent source integrity, models, availability, temporal/prospective validation and governance. Shared D1/R2, markets, identity services, settlement, and platform infrastructure are shared resources requiring platform-level regression tests.
- First verify sport requirements and current production maturity; model/research scope is not evidence of existing working production capabilities. Track unknown/missing controls and never silently substitute other-sport assumptions.
- Do not claim reciprocal agent scheduling or comprehensive per-sport coverage is implemented until Gemini publishes real schedule metadata, ChatGPT sees it from a shared source, every active Github/Worker schedule is inventoried, and a concurrent-write race test passes.
