# Polymarket US market-flow intelligence

Status: staged research foundation; not a completed production intelligence system.

## Controlling contracts

Follow FBIS-MODEL-SYSTEM-STANDARD.md and continuous-learning-governance.md.
Market intelligence is downstream research. It cannot change independent models,
qualification, staking, or wagering authority. No order routes or paid services.

## Official sources

- https://docs.polymarket.us/api-reference/websocket/markets
- https://docs.polymarket.us/concepts/orders
- https://docs.polymarket.us/fees
- https://github.com/Polymarket/polymarket-us-typescript

The documented limit is 100 markets per subscription. The helper accepts 100;
collector selection stays at 48 until resource and coverage validation passes.
Full-book subscription is debounced. Public trades are separately subscribed and
never inferred from book changes. Lite remains available through the helper.

## Implemented foundation

- Fractional book depth (top ten each side), nested full-book stats and state.
- Public trade parser retaining provider price, quantity, currency, maker/taker,
  intent, source timestamp and optional provider identifier.
- Canonical YES instrument direction: BUY_LONG and SELL_SHORT align positive;
  SELL_LONG and BUY_SHORT align negative. Taker order side must agree.
- One fingerprint per print, never a transaction per participant. The documented
  stream lacks a stable trade ID. Identical same-time/size prints are conservatively
  collapsed; observed counts are lower bounds. Full provider reconciliation remains
  required. Never claim complete venue volume.
- One/five/fifteen/sixty-minute observed flow with source-gap and sample gates.
- Actual traded-price movement separated from executable ask and midpoint.
- Buy-side depth simulation fails closed on stale quotes, non-open state, unknown
  quantity units or fees. Fee rule must be explicitly verified and effective at the
  quote time. Per-fill cent ceiling is a conservative research estimate, not the
  provider's exact banker rounding. No assumed rebates or production EV claim.
- Public /api/market-flow forwards bounded market-only evidence from existing DO.
- Shared card component retains current sport-specific designs, team branding and
  existing projections. Unverified mapping yields INSUFFICIENT DATA.

## Resource guard and activation

POLYMARKET_FLOW_CAPTURE must explicitly equal "true" to capture trades. Default
is off. No D1 migration, new database, provider subscription or service is created.
Full books are NOT appended to the high-volume canonical D1 quote ledger.
Flow uses the existing DO: at most 48 markets, 256 trades and 120 thirty-second
quotes per market, persisted no more frequently than once per minute. Existing
per-contract quote persistence remains unchanged. Rotations/gaps invalidate full
window claims. Restarted state begins a new observation window; saved evidence
is inspectable by market and marked with a restart gap. Overflow is disclosed.
Truncation conservatively suppresses pressure until a new capture window.

Do not turn on the switch until the operator can verify existing Workers/DO quota
and cost headroom. Do not raise the market count merely because the protocol allows
it. The production DB is close enough to its size ceiling that bulk expansion needs
a separate retention/archive review; do not delete canonical records automatically.

## Statistical gates

At least five classified trades; at least 90% of observed prints classified;
consistent known provider quantity unit; complete uninterrupted selected window;
a trade in the last two minutes; no truncation. Balanced is within five percentage
points of 50%. Opposing traded-price movement of at least one percentage point
produces MIXED SIGNALS. These are display/research rules, not validated betting rules.

Trade quantity currency is retained as PROVIDER_AMOUNT_USD. This is not relabeled
as contract shares or dollar notional. Book qty is separately retained as provider
contract quantity. No cross-unit normalization is inferred.

## Required before completion

1. Verify live accepted trade and lite subscriptions, exchange field semantics,
   subscription errors, timestamps, duplicates, reconnects and storage costs.
2. Verify named outcomes and settlement from provider rule evidence. Only explicit
   mutually-exclusive two-outcome winner bindings may assign NO-aligned exposure to
   the opposing team. Soccer draws, totals, props and spreads retain named selections.
   Current collector deliberately sets twoTeamWinnerVerified=false, so the proposed
   two-team percentage bars do not yet activate for production markets.
3. Validate exact effective-date and market-specific fee schedules including the
   announced October 19 rebate change. No production fee-adjusted EV until verified.
4. Add replayable canonical/archive evidence, immutable prospective cohorts, scoring,
   holdout/chronological evaluation and qualified benchmark/settlement joins.
5. Complete unified screener, multiple-window charts, book-impact workspace,
   independent-model/PinnOdds comparisons, informed-flow baseline and forward grades.
6. Verify real desktop/mobile cards after deployment. Code/build success does not
   establish source coverage or positive economic performance.

Live telemetry belongs in D1/ops-health and the operator ledger, not this Git doc.
