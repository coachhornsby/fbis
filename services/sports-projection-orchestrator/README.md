# Sports Projection Orchestrator — Render

Render-native port of the Sports Betting Tracker AI orchestrator.

## Contract
- Sports Betting Tracker remains the human UI and persistence ledger.
- Feature Snapshots must be locked and market-blind.
- OpenAI and Gemini run independently from the same point-in-time snapshot.
- Provider raw responses and API usage are persisted before consensus/dashboard writes.
- Consensus is experimental and cannot qualify wagers.
- Any provider/schema/lock/write failure fails closed.

## Runtime
- Web: `node services/sports-projection-orchestrator/server.mjs`
- Cron: `node services/sports-projection-orchestrator/cron.mjs`
- Default cron target: hourly.
- Current model defaults: `gpt-5.6-sol` and `gemini-3.8-flash`.

## Environment
Required for model calls:
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

Required for unattended private Google Sheet reads/writes:
- `GOOGLE_SERVICE_ACCOUNT_JSON` (raw JSON or base64 JSON)
- The service-account email must have Editor access to the Sports Betting Tracker.

Operational:
- `SPREADSHEET_ID`
- `ORCH_CONTROL_TOKEN`
- `MAX_RUNS_PER_INVOCATION`
- `OPENAI_MODEL`
- `GEMINI_MODEL`

No secret belongs in GitHub or worksheet cells.
