# FBIS ingestion rationalization — live inventory checkpoint (2026-10-13)

**Authority boundary:** audit/shadow only. No deletion or disabling of essential sports statistics, game results, injury reporting, official settlement, ranking state, champion projections or immutable market history. Collection success does not equal fresh data or actionable bets.

## Verified production and external evidence
- Audited production GitHub main: `af450e396885407bafe9f1e0fd95844b7b95ccad` (later deploys require independent SHA verification).
- PinnOdds `PINNODDS_API_KEY` already encrypted on `fbis-orchestrator`. Worker **did not have D1 binding or unified request ledger in production** at the audit. The `0101` quota migration is staged in PR #1061; network collection defaults OFF.
- Verified Cloudflare scripts: `fbis-orchestrator`, `fbis-polymarket-us-stream`, `fbis-soccer-pitchapi-backfill`, `fbis-market-probe-20261007`. Do not assume old worker names imply idleness.
- Persistent Polymarket US market stream is deployed with `*/5 * * * *` trigger, but D1 had **only 8 WebSocket observations** (8 markets, 2 games, latest 2026-10-13 05:36 UTC). No claim of continuous BBO.
- Polymarket US public REST had **336** normalized rows across six sport categories (56 per sport); Tennis 0/56 matched, NBA 42/56 and Soccer 42/56, versus 56/56 in sampled CFB/MLB/NHL. These are *offer rows*, not match coverage across all eligible games. No full-coverage claim.
- Polymarket REST and WebSocket source observation timestamps had incorrectly equaled local capture clocks despite provider timing unverified; correction staged separately in PR #1067. Historical records remain intact and unqualified.
- Action governed `external_acquisitions` and `external_acquisition_consumers`: zero rows. Apify acquisition account is `BLOCKED` (`APIFY_USAGE_LIMIT_REACHED`), even though current reported provider usage is approximately $0.054; Action/PrizePicks policies separately `BLOCKED/ACCOUNT_RESTRICTED`.
- User-authorized **single isolated Action diagnostic** Actor `3UHfCU8HRbkOevPYu`, 2026-10-13 07:08–07:09 UTC, 76 seconds, billed **$0.70609**, hard max $1.50. Exactly 100 games sampled from ten requested leagues; **62 CFB, 16 NHL, 9 UCL/Champions soccer, 5 NBA, 4 ATP, 3 WTA, 1 MLB; 0 NFL/CBB**, because maxGames truncated. **97/100** with per-book rows, **88/100** with betting splits, **90/100** with line-movement structures, and **0/100** with populated prop boards despite `includeProps=true`. Historic samples must not be laundered into prospective evidence. Not automatically ingested to D1.
- Free public PrizePicks GitHub mirror publishes NFL, CFB/NCAAF, NBA, MLB JSON (last audited October 12 snapshot), but **does not** currently request NHL, CBB, soccer or tennis. Free mirror display is not authenticated official market execution evidence.

## Ingestion scheduler/endpoint classification

| Scheduler or component | Schedule / observed role | Category | Action and dependency gate |
| --- | --- | --- | --- |
| `mlb-free-odds-collect.yml` | */20 min in 0–5 and 15–23 UTC; free MLB lines | Legacy market pricing | **RETAIN** through PinnOdds + Polymarket same-game/period coverage and timestamp comparison. Verify official-score/settlement dependencies before retirement. |
| `nhl-free-odds-collect.yml` | Same cadence; free NHL moneylines | Legacy market pricing | **RETAIN** until signed sports/reference prices cover every NHL card without stale leakage. |
| `prizepicks-targeted-props.yml` | 5,35 UTC minute in 13–16 hour slots; paid Apify via governed acquisition | Specialized props / dependent workflow | **PAID PATH BLOCKED**. Free mirror is partial, not a verified replacement. Do not enable additional Apify spend, erase PIT snapshots or remove paid route before comparing all sport/market families. |
| `action-daily-snapshot.yml` | Multiple redundant daily UTC trigger windows; paid Action attempt **plus** independent tennis snapshot and NFL wager snapshot steps | MIXED market + sports governance | **DO NOT DELETE ENTIRE WORKFLOW**. First extract tennis/NFL snapshot steps to independent governed workflows. Until then Action remains blocked at the acquisition authority. |
| `action-player-props.yml` | Manual-only paused placeholder | Redundant candidate | Safe candidate for future code cleanup once no workflow references; no active paid schedule. |
| `apify-account-health.yml` | Every hour; provider read-only | Operational accounting | Keep while account state needs reconciliation; lowering read frequency is optional and must not change acquisition authority. |
| `apify-account-audit.yml` | Manual read-only | Operational audit | Retain incident/risk evidence. |
| `polymarket-us-market-collect.yml` | Hourly public discovery and short signed market sample | Exchange discovery/reference | **RETAIN** until persistent stream independently proves reliable contracts, event mapping and BBO. This is not an order execution feed. |
| `polymarket-us-private-reconcile.yml` | Hourly private account read-only | Private positions/account evidence | **RETAIN**, function distinct from public quote collection. Protect private positions and activity. |
| `fbis-polymarket-us-stream` | Cloudflare */5-min activation of persistent signed DO stream | Exchange BBO | **RETAIN**, but NOT HEALTHY merely because any BBO arrived within 24h; alert on last live capture and reconnect errors. |
| `pinnodds-all-baseball-probe.yml` | Every 6 hours; two authenticated REST calls per run, including MLB player specials | Temporary coverage diagnostic | **RETAIN** until normalized specials/player props and period coverage are proven. All calls must use atomic PinnOdds diagnostic reservation after #1061. |
| `pinnodds-mlb-period-audit.yml` | Manual only; up to four provider REST calls | Temporary MLB F5/F3 period diagnostic | **RETAIN** short term; quota-wrap EVERY attempt, retire only after period semantics and supported lines persist in shared ledger. |
| `tennis-action-capability-probe.yml` | Manual only | Conditional research | Keep blocked from uncontrolled paid runs; tennis market matching currently fails in Polymarket sampled US data. |
| CFBD/ESPN/league official, roster, injuries, play-by-play, schedule, rankings and postgame jobs | Sport-specific | Essential sports intelligence | **RETAIN**; never retire because a market-pricing provider replaces some odds. |

## Verified provider differences
- **PinnOdds** = independent source of Pinnacle-sourced *sportsbook reference*, non-executable. 100 free REST calls/day under docs. The `x-api-key` header is documented; the existing legacy probes used `x-portal-apikey`. The new collector sends both only to the same approved PinnOdds origin, pending live access verification. REST only, no SSE/WS entitlement.
- **Polymarket US** = exchange display quote and, independently, read-only signed WebSocket bid/ask/depth. Missing or stale bid/ask MUST remain unexecutable and excluded from economics. International Polymarket is a separate platform, not automatically interchangeable.
- **PrizePicks free mirror** = pick'em prop **threshold reference**, not fixed sportsbook odds. Its third-party snapshots remain research-only until identity, licensing, clock, completeness and independent provider validation.
- **Action** = public money/ticket splits, market movement, opposing bettors, optional stats. Useful as *unique research*, not primary odds, forecast features, qualification, or an execution book.

## Elimination and activation gates
1. **Never stop stat feeds first.** For each legacy market collector, inventory whether it supplies results, injury/roster, scoreboards, lineup state, match identities, pregame PIT or settlement.
2. **Replace before remove.** PinnOdds daily budget and quote normalization must be applied in D1, verified via actual live authenticated calls, league-by-league matched events and market-family coverage for full pregame windows. No stale price substitution.
3. **Fix Polymarket reliability.** Capture truthfully only quotes with valid provider clocks; derive current BBO freshness from actual capture age (<=15m for health evidence, not an exchange source timestamp). Repair tennis mismatch; verify 11 sport categories (8 primary models) and correct overtime/settlement contracts before market comparison.
4. **Shadow compare.** Keep legacy collectors in parallel for coverage, freshness, correct bookmaker attribution, same-event/same-period equivalent lines and prospective closing observations across more than one slate.
5. **No blanket Action restart.** One $0.70609 diagnostic sample demonstrates 88 games with split metrics; no prop boards. It is NOT proof routine paid ingestion provides economic value. Restore only with verified incremental benefit, user-reviewed ongoing cost and legitimate access.
6. **Split mixed workflows.** Decouple Action daily pull from tennis-v2 and NFL wager snapshots before disabling the paid schedule.
7. **Rollback and audit trail.** Retire one ingest path at a time; preserve raw archives, old normalized rows, source tags, proofs, immutable PIT receipts and clear instant rollback to the previous collector. Confirm production SHA and D1 readback after each change.

## Next bounded evidence
- #1061: exact-head CI + production migration 0101 + REST entitlement/dry-run quota evidence before enabling routine polling.
- #1067: exact-head CI and prod deployment + assert new Polymarket source clocks stay NULL when unverified, separate collector capture, and live BBO health flags stale.
- Action: archive/read-only diagnostic dataset **as non-governed trial**; do not insert into `external_acquisitions` with a fabricated receipt, and do not treat Action money splits as independently prospective until source observation times are available.
- Free PrizePicks: expand from existing third-party mirror 4 sports only where provenance and terms permit; other sports require independent validation.
