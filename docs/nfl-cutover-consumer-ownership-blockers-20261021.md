# NFL D1 Cutover — Verified Consumer Ownership Blockers

Reviewed against `main` on 2026-10-21 after #1463. This is a **NO-GO** assessment, not an authority receipt.

| Consumer | Source path | Observed dependency | Cutover implication |
|---|---|---|---|
| NFL wager snapshots | `functions/api/nfl-wager-snapshot.js` → `functions/lib/slateEngine.js` → `functions/lib/nflWagerDecisionStore.js` | API supplies `context.env.DB`; slate engine calls `persistNflWagerDecisionSnapshots(env.DB,...)`; store INSERTs via supplied DB | NFL research/decision writes remain on PRIMARY |
| NFL research publication | `functions/api/nfl-pregame-publish.js` → `functions/lib/nflPregamePublication.js` | API supplies `context.env.DB`; service directly INSERTs `nfl_research_publications` and `nfl_research_publication_events` on `env.DB` | Published research writes remain on PRIMARY |
| Shared published projections | `functions/api/published-projections.js` → `functions/lib/publishedProjectionStore.js` | API supplies `context.env.DB`; store reads/writes `published_projections` on `env.DB` | Multi-sport ownership must be partitioned per sport before migration |
| Shared projection board | `functions/api/projections.js` → `functions/lib/slateEngine.js` | API supplies `context.env.DB`; slate engine reads NFL profiles and writes NFL wager-decision snapshots through PRIMARY | Read/write ownership split required; market overlays must not be switched to sport D1 |
| CORE summary | `functions/lib/coreBoardConsumer.js` and CORE aggregation | Separate CORE contract | Must remain complete when NFL source authority changes |

## Determination
* 11/11 synchronized and qualified shadow databases: **accepted** from production qualification run `39605534420`.
* Routing contract tests: **merged** in #1462.
* NFL consumer inventory: **merged** in #1463.
* All NFL readers/writers routed to the sport DB with safe rollback: **NOT PROVEN**.
* Runtime binding, live dual-read, fresh-write reconciliation, CORE completeness and rollback: **NOT PROVEN**.
* Operator-authorized NFL cutover: **NOT GRANTED**.

## Mandatory acceptance sequence
1. Separate market/CORE tables from NFL-owned tables. Route NFL-only read/write transactions through `productSportDbHandle` at each actual consumer; prove legacy PRIMARY remains readable during rollback.
2. Run concurrency/fresh-write and schema-compatible live-route differential checks using identifiable NFL records; compare post-write rows in both databases. No synthetic receipts counted as live evidence.
3. Confirm deployed Pages and Worker bindings and active production SHA match tested code.
4. Verify CORE cross-sport board, freeze/projection immutability, settlement and market-history independence.
5. Demonstrate switching back to PRIMARY with recent data recoverable, independent of sport DB availability.
6. Require explicit signed/time-bounded approval before setting any `SPORT_DB_MODE_NFL=sport` or approval receipt. Never couple this to wagering authority.
7. Preserve PRIMARY/R2 copies and disable deletion until archive/checkpoint and rollback retention gates independently pass.

**Safe action now:** keep NFL in shadow mode and PRIMARY authoritative. Do not call the migration fully cut over.
