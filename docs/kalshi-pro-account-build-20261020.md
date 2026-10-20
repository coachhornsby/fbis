# FBIS Kalshi account and Kalshi Pro workstream (2026-10-20)

## Scope and production authority
- A private ACCOUNTS route with Kalshi REST account snapshot: balance, unsettled positions, resting orders, and recent fills. Manual refresh and minute reconciliation.
- Kalshi public pricing adapter already exists in functions/lib/kalshi.js; it is cached sentiment research, NOT an executable quote engine.
- Authenticated WebSocket handshake/subscribe transport is staged in functions/lib/kalshiAccountStream.js, with fill, market_positions, and user_orders channels. NOT running in production. Durable Cloudflare Worker/DO hosting, reconnect logic, health monitoring, event persistence and REST-after-reconnect sync are mandatory before enablement.
- No write/trade/cancel/transfer calls. No wagering or model qualification authority. No private positions in public game cards.
- No new D1 tables/writes for this first stage; the existing market-history database has an active capacity issue.

## Private access and Cloudflare setup
Configure separate Cloudflare Pages SECRETS (not public vars):
- KALSHI_API_KEY_ID: ID of a new Kalshi API key.
- KALSHI_PRIVATE_KEY_PEM: its PKCS#8 Ed25519 PRIVATE KEY PEM (Kalshi recommended). Multiline or escaped newline is accepted. RSA PKCS#1 is deliberately not supported in this initial adapter.
- FBIS_ACCOUNT_VIEW_TOKEN: independent high-entropy operator access code, needed to read GET /api/kalshi-account.

The UI asks only for FBIS_ACCOUNT_VIEW_TOKEN, never the Kalshi signing key. It keeps the code only in React state, not localStorage, URLs, or D1. The backend compares SHA-256 token digests. No permissive CORS and private, no-store HTTP responses.

Public FBIS market pages remain public. Never let the account endpoint fall back to anonymous access. For multi-operator use, replace the shared token with verified Cloudflare Access identity before widening access or writing private position history.

## Acceptance
1. Configure the three secrets on production Cloudflare Pages.
2. Confirm GET /api/kalshi-account without an access header gets 403 and never makes upstream requests. Without a configured access token: 503.
3. Sign the documented timestamp + GET + path without query string.
4. Interpret balance_dollars as dollars and portfolio_value as integer cents. Show cash, position valuation, and total separately.
5. Show incomplete pagination explicitly. Failed upstream requests must not appear as zero balances.
6. Verify responsive accounts page, logout/reload access gate, and no private data in the public board.
7. Deploy a separately authenticated Worker/DO for WebSocket lifetime, reconnect, missed-event reconciliation, and controlled private event persistence. Do not use browser-provided Kalshi secrets.
8. Never count fills as economically graded bets without settlement, fees, outcome, execution time, and FBIS decision evidence.
9. Run test/kalshi-account.test.js, npm run build, and the relevant existing navigation/security tests. Review GitHub CI prior to merge.

## Kalshi Pro features worth recreating
Priority A: live portfolio and fills; quote and order-book screener ranked by executable net edge; spread/depth at intended size; trade tape.
Priority B: combos with quoted combined prices, verified legs, fees and correlation guard.
Priority C: configurable tile workspaces by sport, positions and watchlist.
Exclude perpetual futures/crypto leverage from the FBIS sports deployment. Kalshi Pro is an interface, not a separate account API.

## Heritage sunset criteria
- Keep PinnOdds as independent sharp reference. Heritage may be retired as an execution venue only after matched side-by-side total-net-value comparisons by sports and market type.
- Track line/market availability, posted bid and ask, fillable cost at stake, exchange fees, fill risk, hours, resolution terms and realized net returns.
- Give Kalshi and Polymarket US distinct provider identities; Polymarket International Gamma/CLOB is a different system.
- Never treat a sentiment midpoint as a fillable order price or assume superficially similar spread/total contracts have equivalent settlement rules.
- Preserve Heritage history, PinnOdds captures, and existing executed ledgers.
- No automated execution until explicitly authorized with confirmations, idempotency, limits, kill switch and separate tests.

## Official documentation
- https://docs.kalshi.com/api-reference/portfolio/get-balance
- https://docs.kalshi.com/api-reference/portfolio/get-positions
- https://docs.kalshi.com/api-reference/portfolio/get-fills
- https://docs.kalshi.com/api-reference/orders/get-orders
- https://docs.kalshi.com/getting_started/api_keys
- https://docs.kalshi.com/websockets/websocket-connection
- https://pro.kalshi.com/pro/help/get-started
