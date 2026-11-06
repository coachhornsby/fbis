# FBIS source policy — November 6, 2026

Owner instruction: Apify, Parlay and The Odds API are retired until a future explicit decision.

Approved markets: PinnOdds; Kalshi REST and WebSocket; Polymarket REST and WebSocket (US/global where the existing integration supports them).

Retained statistics/model resources: ESPN, CFBD, CBBD, KenPom, Torvik and existing NFL, NBA and NHL resources. This source policy does not restart paused jobs, change sport scope, authorize spending, or authorize wagers.

Retirement blocks provider HTTP requests even when stale credentials or flags are present. Apify launches and mutation/refresh routes fail before database or network work. Legacy odds resolution cannot select a retired fallback or qualify its cached result. Secret sync skips retired credentials. Historical source records and pure normalization helpers remain for audit and replay.

No database history or provider account is deleted. Repository changes do not cancel subscriptions, disconnect the user’s ChatGPT plugin, or delete deployed secrets. Deployment and external-account cleanup must be verified separately; a branch or PR is not proof of live retirement.
