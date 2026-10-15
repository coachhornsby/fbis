# Soccer Phase 3H-R4 — production closeout

Verified October 15, 2026. Classification: **PROSPECTIVE_SHADOW_READY**.

The canonical null-season repair, bounded memory repair and verified provider-name reconciliation ran successfully in production. The prospective first-write and same-bucket retry contract passed for Bundesliga and Ligue 1. This is infrastructure readiness, not economic qualification. Recurring collection is not activated by this report.

## Deployment and proof identity

| Check | Verified result |
|---|---|
| Main and current production SHA at verification | `77d0a5f86cb3c76183c58ca5867cbc57335c7943` |
| Current production deployment ID | `594fdfb0-629b-4139-ada2-7cdb44012ac6` |
| Production completed | `2026-10-15T05:15:41.677036Z` |
| Successful proof collector/trigger SHA | `50d3e2ca820baa9511a680c8c25def1ed936a277` |
| Ancestry to null-season repair `9b1202f6...` | Proof collector is a verified descendant, 442 commits ahead |
| Current production ancestry | 23 commits ahead of successful proof collector |
| Successful authenticated workflow | GitHub Actions run `38525616858`, SUCCESS; CI `38525616730`, SUCCESS |
| Proof slate | October 17, 2026, genuinely future at both snapshots |
| Evidence file | `ops/soccer-phase3h-r-proof-latest.json`, generated `2026-10-14T07:05:35Z` |

The original stale-Pages blocker had cleared. A fresh proof then exposed Cloudflare 1102 resource failures. Model-history SELECT * was loading roughly 40–49 MB of unused raw JSON per core league. Model acquisition now selects the scalar features consumed by the models; full raw source payloads remain retained for audit/profile paths. The one-shot works in competition batches. Histories, coefficients and gates were not shortened or weakened.

Germany subsequently failed cross-provider names despite sufficient history. Verified competition-scoped aliases reconcile Bayern Munich/Bayern München, Hamburg SV/Hamburger SV, 1. FC Union Berlin/Union Berlin and Mainz/Mainz 05. Numeric provider IDs are not equated. These repairs are now present in current source and the successful collector.

## First write and retry

| Measure | First | Retry |
|---|---:|---:|
| Fixtures examined | 9 | 9 |
| Core canonical v2 successes | 9 | 9 |
| v2 + v3.1 eligible fixtures | 7 | 7 |
| Attempted rows | 70 | 70 |
| Written rows | 70 | 0 |
| Existing rows | 0 | 70 |
| Bundesliga snapshot | `2026-10-14T07:05:06.049Z` | `2026-10-14T07:05:22.702Z` |
| Ligue 1 snapshot | `2026-10-14T07:05:16.010Z` | `2026-10-14T07:05:30.597Z` |

All four actual timestamps differ and share five-minute bucket **5973205**, starting 07:05 UTC. Ledger before this proof: **50** rows. After: **120** rows across **8** total distinct events. The earlier 20-row initial baseline and 30-row Ligue 1 diagnostic run account for the preceding 50; they are not counted as the new 70.

## Canonical-league evidence

| Competition | Canonical league history | Fixtures | v2 successes | Eligible challenger fixtures |
|---|---:|---:|---:|---:|
| ger.1 | 342 | 6 | 6 | 4 |
| fra.1 | 350 | 3 | 3 | 3 |

Union Berlin–Dortmund, Hamburg–Stuttgart and Bayern–Leipzig each had 38 canonical matches per side. Schalke–Mainz had 4/38. Strasbourg–PSG and Lille–Brest had 39/39; Troyes–Lens had 5/39. Exact fixture diagnostics and provider flags remain in the proof JSON.

Remaining skipped Bundesliga fixtures:

| Fixture | Canonical home/away history | v2 | v3.1 reason |
|---|---:|---|---|
| SV Elversberg–FC Augsburg | 4 / 38 | OK | insufficient-pitchapi-history |
| Werder Bremen–SC Paderborn 07 | 38 / 4 | OK | insufficient-pitchapi-history |

An independent D1 check found five finished Bundesliga PitchAPI matches for each promoted club, below the unchanged eight-team-match challenger minimum. These exclusions remain fail-closed. Neither is a history-0 loader failure.

## Persisted-row audit

Every one of the 70 newly persisted records was inspected at the data source, including IDs, selections, kickoff/snapshot times, route/version, evidence snapshot/SHA, model IDs, probability/projection values, market fields and full provenance.

| Competition | 1X2 | BTTS | GOALS | O2.5 | AH |
|---|---:|---:|---:|---:|---:|
| ger.1 | 12 | 8 | 12 | 8 | 0 |
| fra.1 | 9 | 6 | 9 | 6 | 0 |
| Total | 21 | 14 | 21 | 14 | 0 |

New proof: **7 events, 2 competitions, 4 families, 0 genuine-market rows, 70 explicit unavailable-market rows**.

- GOALS probabilities are NULL; both numerical goal forecasts are populated.
- Probability-family v2/v3.1 values lie within [0,1].
- Missing market probabilities, lines, prices and timestamps remain NULL, with explicit reasons.
- No Asian-handicap observations were manufactured without qualifying evidence.
- All rows precede kickoff and bind the expected immutable route and evidence version/SHA.
- All rows have research_only=1, can_qualify=0, can_authorize=0.
- All provenance confirms modelMarketSeparation=true; v2MarketUsed=false; v31MarketUsed=false; persistentStateUsed=false; executionEvidence=false; authoritativeModel=SOCCER-FBIS-v2; publicProjectionRoutingChanged=false.
- Collector SHA and model-freeze timestamps agree with the actual persisted snapshots.
- **Zero row violations. Zero duplicate shadow IDs or duplicate event × family × selection × five-minute observations across the full 120-row ledger.**

The lack of contemporaneous prices means prospective CLV, market-relative edge realization and simulated ROI remain unavailable. No economic claim follows from this proof.

## Routes, migrations and historical independence

- 50 immutable routes, 10 competitions, 5 families; 27 PASS, 17 PARTIAL_PASS, 1 FAIL, 5 INSUFFICIENT_EVIDENCE; 44 shadow eligible; zero route governance violations.
- EPL 1X2 remains FAIL/incumbent-only. UEL's five routes remain insufficient/ineligible. Existing regression tests cover PASS/PARTIAL eligibility and stale/wrong-SHA evidence falling back to v2.
- Soccer migrations 0079 and 0081 are applied.
- Championship Stage B: 251 DONE shards / 2,878 persisted. UEL: 77 DONE / 817 persisted. These acquired records remain retained.
- Historical queue-drain cadence remains every five minutes, independently of prospective proof. Completed shards are not rescheduled merely to raise proof counts.
- UEL advanced authority remains deferred; no routes or backfill policies changed to force readiness.

## Cards and team profiles

The deployed board includes club branding, larger 104px crests, responsive 20–29px names, team-color accents and larger colored matchup text/values. A production browser check measured approximately 24.5px names at the inspected desktop width. The TEAMS view includes 240 entries across the ten research competitions, acquired match history, sourced/retained roster snapshots and 35 PitchAPI advanced metrics with coverage, source dates and last-ten comparisons.

Barcelona's verified profile showed 90 PitchAPI matches and 30 roster players. Its big-chances display reconciles retained raw full-match observations rather than trusting legacy zero-filled values. Club/profile display does not alter model authority.

## PLATFORM LEARNING CANDIDATE

Nullable numeric filters can silently create false constraints or false zero evidence. The original null-season predicate is repaired. The separate PitchAPI numeric helper now explicitly rejects null, blank and boolean inputs in current source. Legacy big-chances source/storage mismatches still demonstrate why historical records need source reconciliation rather than indiscriminate zero replacement.

Infrastructure lessons: bound edge model-history payloads; retain raw source outside the model working set; use competition-scoped verified aliases; verify deployed ancestry; preserve actual acquisition times and explicit NULL market semantics; retain non-JSON failure evidence. These are data/governance practices, not predictive assumptions transferable between sports.

## Final authority and next phase

**PROSPECTIVE_SHADOW_READY**.

Public v2 remains authoritative. Persistent-state projection influence, automatic qualification and wager authorization remain OFF. v3.1 remains research-only. The complete next prompt is `docs/soccer-phase3i-activation-prompt.md`. It specifies recurring collection and forward evidence accumulation; this closeout does not activate its scheduler or grant wagering authority.
