# Phase 3I — recurring prospective shadow activation and forward evidence accumulation

Continue Soccer FBIS from the verified Phase 3H-R4 PROSPECTIVE_SHADOW_READY checkpoint. Before implementation, re-establish main/Pages/collector SHAs, successful R4 evidence, migrations, immutable route evidence/version/SHA and D1 ledger totals. Do not equate main with production.

Preserve the architecture: public v2 structural incumbent → league × market-family v3.1 research challenger → prospective shadow → predictive/economic evaluation → separate selective qualification decision. Persistent team/player profiles stay excluded from projection influence. UEL historical collection continues independently; UEL advanced authority remains deferred.

## 1. Recurring collection and snapshot windows

Implement a dedicated authenticated five-minute collector, independent of historical acquisition and deployment workflows. Inspect only the next 72 hours, supported mapped competitions and immutable shadow-eligible routes. Bound work by competition/event so edge resource limits do not recur. Reject post-kick snapshots; retain actual acquisition time rather than backdating missed work.

Capture kickoff-relative windows:

| Window | Allowed acquisition interval |
|---|---|
| T−24 hours | ±15 minutes |
| T−6 hours | ±15 minutes |
| T−60 minutes | ±10 minutes |
| T−15 minutes | ±5 minutes |
| Closing observation | T−5 to T−1 minutes, strictly pre-kick |

Retain deterministic five-minute idempotency. Reconcile event × competition × family × selection × window separately. Multiple windows are legitimate correlated observations, not independent games. A delayed run records a missed window; it does not reconstruct prospective evidence retrospectively. Bound retries/concurrency and reserve capacity for closing capture.

Freeze actual v2/v3.1 outputs, feature cutoff, route/version, validation evidence snapshot/SHA, collector SHA, source observation timestamps, market availability and missing reasons. Check actual provenance before asserting compliant ledger flags. Require v2/v3.1 marketUsed=false, v3.1 postMatchTargetFeaturesUsed=false, persistentStateUsed=false, research_only=1, can_qualify=0 and can_authorize=0. Reject contaminated observations.

## 2. Market and closing semantics

Market data remains independent of predictive inputs. Never synthesize odds or market probabilities from model outputs.

- 1X2 requires all three genuine outcomes from a coherent source snapshot.
- BTTS requires complete Yes/No prices.
- O2.5 requires exactly 2.5, both prices and computable no-vig probability.
- Asian handicap accepts only −0.5, 0 or +0.5 with a complete corresponding two-way market.
- Require a genuine observation timestamp no later than snapshot acquisition, strictly before kickoff and no older than 20 minutes. Reject future/negative-age timestamps.
- Missing, incomplete, mismatched or stale evidence stays NULL with an explicit reason.
- GOALS rows retain numerical home/away/total forecasts. They do not acquire invented market probabilities or economic authority.

Capture a comparable pre-kick close with matching event, period, family, selection and supported line. A changed total/handicap is not directly comparable CLV. Keep source identity explicit. Missing/stale/non-comparable close evidence leaves CLV NULL.

## 3. Results, cohorts and reconciliation

Grade only verified final results linked to canonical event/team identities. Postponed, abandoned, disputed and unmatched games remain ungraded with reasons. Preserve frozen original predictions; never recompute them after the result.

Track league × market-family × snapshot-window cohorts. Report unique events, forecast rows, genuine-entry-market events, close-linked events, graded events, source coverage and exclusions. Outcome rows and windows from one match are correlated: minimum-sample gates and confidence intervals must use unique events.

## 4. Predictive evaluation

Compare v2 and v3.1 on exactly matched out-of-sample frozen events:

- 1X2: multiclass Brier (explicit sum over three outcomes), multiclass log loss, per-outcome reliability curves and ten fixed-bin ECE with bin counts.
- BTTS/O2.5: binary Brier, binary log loss and fixed-bin ECE.
- Asian handicap: report win/push/loss separately; assess conditional win probability on decisive results and disclose that scope.
- GOALS: home, away and total-goal MAE, signed bias and sample counts.

Disclose log-loss clipping conventions. Bootstrap uncertainty by event, not by individual outcome row. Sparse bins and missing outcomes remain labeled. Forecast-only improvement is insufficient economic evidence.

## 5. Prospective economics

Pre-register one selection policy per league/family/window before viewing outcomes. Avoid hindsight selection and duplicate simulated stakes across correlated rows/windows. Use one hypothetical unit risked per included selection, correct decimal-price conversion and explicit push/void handling.

Simulated units = summed net settled profit. Simulated ROI = net settled profit / settled units risked; disclose denominator and void/push conventions. Incorporate declared slippage/transaction-cost assumptions without misrepresenting them as observed fills.

For comparable complete markets, probability CLV = closing no-vig selection probability minus entry no-vig probability. Report price CLV separately with its sign convention. Missing-market rows and numerical GOALS forecasts do not count as economic observations. This is simulation, not execution evidence.

## 6. Minimum evidence and stability gates

Pre-register conservative review thresholds. No automatic promotion:

1. At least 60 calendar days after recurring activation.
2. Per candidate league × family: at least 100 unique graded out-of-sample events with genuine entry prices, including at least 50 with comparable pre-kick closing observations.
3. At least 30 market-linked graded events in each of two successive non-overlapping 30-day windows. Continue collecting if the calendar cannot supply them; do not pool unrelated leagues to bypass the gate.
4. Rolling 30-day/60-day predictive, CLV and economic metrics plus weekly summaries; report uncertainty and sparse cohorts.
5. Matched-event predictive improvement over v2 AND prospective economic evidence. Probability families need lower Brier/log loss without material calibration regression; GOALS needs lower MAE. Use event-clustered uncertainty and a declared multiple-comparison policy across tested routes.
6. Positive mean comparable CLV and net simulated units/ROI after declared costs, with stable direction across both non-overlapping windows. Adverse or uncertain evidence remains insufficient.

These are research-review minimums, not wagering criteria or profitability promises. Qualification is league-specific AND market-family-specific. One successful route cannot qualify other leagues/families. Apply an explicit versioned PASS/PARTIAL_PASS/FAIL/INSUFFICIENT_EVIDENCE rubric and require a separate qualification decision. Never activate a wager automatically.

## 7. Shared platform health

Publish scheduler heartbeat, actual deployed/collector SHA, start/end/latency, fixtures examined/eligible/skipped, attempted/written/existing rows, failures, missing/stale markets, missed windows, failed closes, result-join failures, grading lag, duplicates and provenance violations. Reconcile run counters to D1 changes and unique logical observations.

Alert on two missed expected heartbeats, temporal/provenance contamination, duplicated logical observations and unexplained ledger discrepancies. Fail closed for governance violations and provide an operator kill switch. Keep Stage B/UEL historical cadence independent.

Team profiles continue displaying source dates, roster/stat freshness and per-metric coverage. Profile completeness is not predictive qualification.

## 8. Validation, deployment and report

Test idempotency, actual provenance rejection, pre-kick timing, missing/stale markets, supported exact lines, push/void settlement, event identity joins, matched-cohort calculations and ledger reconciliation. Deploy and verify actual collector/scheduler SHAs. Prove two real scheduled pre-kick cycles and D1 reconciliation.

Report activation timestamp/cadence, snapshot windows, route-specific samples/coverage, predictive/economic metrics, minimum-gate status, rolling stability, calendar duration, missed windows, duplicates, governance and historical continuity. Public SOCCER-FBIS-v2 remains authoritative until a separate explicit league × family qualification decision. Persistent-state projection influence remains OFF. Qualification and wager authorization do not become automatic in Phase 3I.
