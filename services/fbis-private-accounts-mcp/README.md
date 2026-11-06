# FBIS private account MCP connectors

Private, manual-only **read** access to Polymarket US and Kalshi account snapshots through existing Cloudflare Pages account readers. No trading access, no auto polling, no D1/R2/DB writes, and no new data collectors.

Plugin endpoints: `https://fbis-private-accounts-mcp.coachhornsby.workers.dev/polymarket/mcp` and `/kalshi/mcp`.

Cloudflare Worker secret configuration:
- `FBIS_POLYMARKET_MCP_TOKEN_SHA256` and `FBIS_KALSHI_MCP_TOKEN_SHA256`: SHA-256 hashes of unique private-plugin bearer credentials. Do not commit raw credentials.
- `FBIS_ACCOUNT_VIEW_TOKEN`: Existing owner account-view token used by protected Pages `GET /api/polymarket-account` and `GET /api/kalshi-account` (not provider signing credentials). **Required for upstream connectivity**. Enter this through Cloudflare Secrets UI after matching existing operator access; never post it to chat or commit it.

The provider keys remain bound only in Pages: `POLYMARKET_US_KEY_ID`, `POLYMARKET_US_SECRET_KEY`, `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY_PEM1`. The Worker forwards the view secret only to fixed FBIS Pages URLs and accepts only POST JSON-RPC MCP calls, with a separate bearer token for each provider.

Responses include per-provider timestamps, completeness flags and sanitized balances, positions, fills/trades and open orders. No settlement-history assumption or verified ROI without reconciliation. Plugin status never calls Pages. If `ACCOUNT_VIEW_SECRET_NOT_CONFIGURED`, configure the view token secret in the Worker. Do not reset the existing Pages operator token without coordinating the UI.

Manual-only refresh. Each account tool invocation triggers one Pages account GET; the Pages adapter itself uses bounded provider GETs. No cron, no scheduled server calls, no D1 or R2 operations. Protect the existing $10/month Cloudflare budget.
