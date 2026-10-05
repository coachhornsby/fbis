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
