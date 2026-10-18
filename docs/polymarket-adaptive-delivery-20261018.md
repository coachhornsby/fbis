# Polymarket US card and intelligence delivery

REST establishes the market inventory and first full book for upcoming canonical games with an existing independent pregame forecast. The persistent read-only US WebSocket supplies full-book updates and public trade prints. No trading endpoint, account permission, model promotion, or wager authorization is added.

## Card behavior

CompactGameCard and its styling are unchanged. Expanded MoneylinePriceComparison keeps the existing PinnOdds / Polymarket / FBIS layout and adds observed buy/sell American equivalents, a standard-taker fee estimate, size-aware $5 entry estimate, break-even price, and explicit VERIFY/PASS/WATCH/CONSIDER research assessments. A two-percentage-point threshold is an unvalidated research display policy, not a qualification rule. Missing timestamps, unknown settlement equivalence, market suspensions, insufficient book depth, and kickoff prevent a CONSIDER state. No assumed rebate, guaranteed fill, new model coefficient, or automatic stake increase.

Expanded panels request sanitized stored quotes every five seconds while visible. The browser never contacts Polymarket, sends credentials, recomputes sports projections, or changes compact-card state. The existing slate refresh remains independent.

## Ownership and recovery

The authenticated bootstrap route accepts a bounded catalogue/page/quotes operation. Provider queries are time-bounded to the next 48 hours and sport-tag scoped; only uniquely matched forecast games enter the ledger. Each run visits at most three 20-event pages per eligible league; coverage remains explicitly partial. Four contracts per quote operation limits each provider/book request. REST writes reserve primary capacity below 9.5 GB. R2 archives source pages, receipts and contract metadata privately before stream subscriptions. An empty provider page is not proof no games are scheduled.

The existing stream remains the single WebSocket owner. Full books retain up to twenty price levels. Trade notifications are parsed separately from prices, archived in bounded private R2 batches and counted only for the current connection window. Dropped/archive-failed counts remain visible; captures are not asserted exhaustive. Market suspensions can invalidate older open quotes.

Website delivery reads primary plus the existing history recovery store, chooses newer evidence per source/contract/side/period/line, and preserves original provider and collection times. Recovery reads do not migrate data or make it authoritative for wagers. Raw payloads, signing material and private account data are not returned to the browser.

## Operations

`polymarket-projected-bootstrap.yml` runs at minutes 7 and 37 and on bootstrap source releases. It establishes REST contracts and activates the existing stream. Discovery does not crawl unsupported/unforecast sports. Provider 429s halt the run. Receipt replay avoids repeat book acquisition. Source timestamps remain distinct from arrival time; no provider timestamp is synthesized.

Pure FBIS probabilities remain independent. Net edge changes with price, depth, fees and freshness; this is adaptive assessment, not online model training. Archived immutable source/quote/trade evidence supports later time-correct research. Provider-specific access, published games, settlement equivalence and retrospective profitability must be verified independently.

## Known scope

Initial bootstrap targets independently forecast rows in `games`; the separately managed official tennis fixture path is not widened. Player props retain their separate identity, model and qualification requirements. Fee calculations are estimates before actual fill-level rounding and minimum trade checks, with no account rebates assumed. Unknown settlement rules stay VERIFY. Full cross-sport market-informed learning requires a later out-of-sample challenger study.

## Complete inventory reconciliation

The no-partial-coverage release removes the fixture count, catalogue-page, event-page, embedded-market and per-sport subscription cutoffs. Catalogue pages and event pages continue to exhaustion. Every independently matched provider game receives a complete `/v1/events/{id}` detail retrieval, verified against the provider market count and processed in bounded local pages; all eligible moneyline/spread/total contracts enter book initialization. Provider league metadata supports name-based aliases consistently.

Production `STREAM_COVER_ALL_ELIGIBLE=enabled` scales the subscription plan to every eligible contract using bounded 50-market frames. Actual subscribed market identities are compared to the collected inventory, not only subscription totals. Provider errors, identity ambiguity, absent games, unavailable books, and missing subscriptions keep the run in GAPS and fail its completion check. Unavailable provider inventory cannot be manufactured. The scope remains independently forecast team games in the next 48 hours; player props and the separate official tennis path retain their distinct model requirements.

`GET /api/polymarket-bootstrap` exposes the last coverage report with exact missing events/books/subscriptions, source scope and check time. Reports older than 40 minutes cannot claim complete coverage. The scheduled job starts with IN_PROGRESS and only publishes COMPLETE after identity-level reconciliation. Per-request response-size, database-capacity, provider-rate and job-time safeguards remain; hitting a safeguard is an explicit failure, never an exhausted inventory.

Live verification showed `/v1/markets?gameId=...` returning zero markets even while the event detail advertised and returned hundreds. Event detail is therefore the enumeration authority; mismatched advertised counts fail closed. Provider `/v2/sports` metadata identifies soccer leagues (including NWSL) rather than guessing from league names. Verified Spanish/German club aliases retain league/two-team/kickoff matching gates.

The stream release uses an alias-first Durable Object class rename. This preserves the existing namespace and stored data while replacing a WebSocket-pinned older class. Health verification requires the intended code version and actual subscription identity list before the release can pass. Bounded persistence batches drain promptly when backlog exceeds one batch; no quiet contract is evicted to fit a fixed queue size.
