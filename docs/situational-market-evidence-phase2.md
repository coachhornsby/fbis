# Situational market evidence — Phase 2

Offline NFL/CFB research only. Dependency: draft PR #930 at `d754f09c5dc56de4c6698b5dc578404fab5f971f`. Production remains `d5d8499050c7ac0ce607d709baa234c4809678ec` at inspection. No routes, jobs, production writers, migrations, model imports, paid acquisition or authority changes are introduced. No valid historical edge is asserted.

## Read-only inventory, 2026-10-09 22:18–22:32 UTC

Exact SQL, schemas, result counts, query metadata and retrieval times are retained in the accompanying evidence bundle. The inventory is a multi-query observation, not an atomic database backup. SQL responses report zero rows written. Counts below are records, not independent games or executable offers.

| Population | NFL | CFB | Original provider clock | PIT conclusion |
|---|---:|---:|---|---|
| ACTION book observations | 13,089 | 37,374 | 0 / 0 populated | PROVENANCE_INCOMPLETE; no PIT-eligible quotes |
| ACTION spread subset | 4,395 | 13,238 | 0 / 0 | Original signed lines/prices remain descriptive |
| ACTION shadow observations | 430 | 1,148 | 0 / 0 `source_observed_at` | PROVENANCE_INCOMPLETE |
| ACTION shadow books | 3,860 | 10,592 | No book-level source clock | PROVENANCE_INCOMPLETE |
| Normalized markets | 0 | 0 | UNAVAILABLE | UNAVAILABLE (126 Tennis consensus rows are not NFL/CFB evidence) |
| Odds snapshots | 3,944 | 50,929 | No original-clock/raw-reference fields | RETROSPECTIVE_UNVERIFIED |
| Canonical prospective evidence | 15 | 0 | 0 NFL `market_observed_at` | Temporal flag alone does not prove market PIT |
| Economic grades | 0 | 0 | Not applicable | UNAVAILABLE |

ACTION canonical IDs are missing in 420 NFL and 11,380 CFB rows. Non-null canonical IDs and source parents have zero observed orphans. All ACTION rows have acquisition clocks, payload hashes and price fields; field presence is not verification of raw-byte availability or original availability. Acquisition was at/after kickoff for 5,195 NFL and 36 CFB rows (SQLite `julianday`, not lexical comparison). None becomes eligible merely because acquisition preceded kickoff. ACTION data covers September 2026 only: NFL kickoff September 15–25; CFB September 17–20. Season labels beyond these timestamps were not independently audited.

ACTION spread capture groups have 2,190 NFL and 6,617 CFB structural opposite-side pairs; PIT-valid pairs remain zero. Catalog identifiers `consensus` and `openingline` are not authenticated named bookmakers: NFL 2,149 / 2,046 rows; CFB 5,708 / 5,708. Zero duplicated ACTION unique observation keys does not prove absence of repeated acquisitions. Shadow books have 120 NFL and 383 CFB repeated parent/book/period groups; differences in market ID or live status require audit before calling them duplicate quotes or purchases. Odds-snapshot event orphans and malformed populated prices are zero; missing prices remain missing, not zero. Price-change history cannot be certified without source clocks.

Production `/api/health` reported HEALTHY and matching deployment identity; schema tip remains 0097. Scheduled research run `37997304116` failed CBB and Soccer collect after two non-JSON HTTP 503 responses. NFL/CFB collect jobs succeeded in that run; workflow success does not prove usable market quotes. ACTION, PrizePicks and Apify remain BLOCKED. Free backup NFL/CFB odds were unavailable at the earlier health inspection. No provider was queried or reopened by this prototype.

## Adapter contract and trust boundary

`research/situational/marketEvidence.mjs` is a pure local adapter; `artifactStore.mjs` writes local artifacts only. `fromStoredRow` preserves unavailable clocks as NULL. It does not infer team IDs, league, bookmaker, original timestamps or raw references from names or collection times. Shadow book schemas do not have a supported automatic mapping; preserve them in inventory rather than inventing an adapter.

`adaptObservation(record, context)` takes:

- Record: observation ID, canonical/provider event IDs, NFL/CFB sport and league, canonical home/away/selected-team IDs, kickoff, FULL_GAME_SPREAD / FULL_GAME, HOME/AWAY side, signed selected-team line, integer American price (absolute value ≥100), named bookmaker, source, original observation clock, separate acquisition clock, immutable source reference and raw-byte SHA-256, explicit sign convention.
- Context: verified canonical event manifest with provider home/away IDs, identity provenance and original availability; explicit research decision; source-specific policy with version, reference, TTL and bookmaker allowlist; exact raw UTF-8 JSON object; independently audited schema mapping with original-clock semantics, availability, reference and exact field paths.

Raw binding covers provider event and team IDs, sport, league, selected side, market/period, book, price, source clock and line. Selected-team line conversion is allowed only under an explicitly verified HOME_TEAM_SIGNED convention. Observation ≤ acquisition ≤ decision < kickoff, zero future skew, inclusive TTL boundary. Missing or malformed timestamps, unsupported periods, event/team conflicts, post-kickoff data, unknown books, odds errors, raw hash/field mismatches and duplicate/conflicting observation identities produce explicit exclusion reasons and NULL quote.

`verified` / `pitVerified` flags and reference strings are attestations, not digital signatures or proof of external history. The adapter cannot certify their truth. PIT_VERIFIED means the contract passed against independently audited supplied context; independent source/identity/availability audit is mandatory before real use. No production population inspected here has qualified. Later retrieval never supplies original pregame availability. Source/acquisition/archive/decision clocks must remain separate.

`adaptPopulation` rejects both members of a conflicting pair, retaining the bounded conflicting pair for deterministic candidate reload. Use complete source populations, not handpicked rows. `movement` revalidates inputs and permits only one event/book/market/period/selection with original ordered clocks; line changes and price changes are separate. Reverse movement and public disagreement stay NULL without authenticated public evidence and denominator.

## Offline operations

```sh
node scripts/situational-market-evidence.mjs adapt local-source-input.json
node scripts/situational-market-evidence.mjs movement local-adapted-series.json
node scripts/situational-market-evidence.mjs register local-protocol.json local-artifacts
node scripts/situational-market-evidence.mjs candidate local-candidate-input.json local-artifacts
node scripts/situational-market-evidence.mjs grade local-grade-input.json local-artifacts
node scripts/situational-market-evidence.mjs summary local-cohort-manifest.json
node --test test/situational-discovery.test.js test/situational-market-evidence.test.js
```

Adapt input: `{records,contexts}`. Movement input: `{results}` from adaptation. Candidate input: `{game,adapterInput,protocolPath,codeSha}`; `adapterInput` is retained verbatim from the adapter, including a conflicting source pair when excluded. Grade input: `{candidatePath,outcome,evaluation}`. Summary input: `{protocolPath,candidatePaths,gradePaths}`. Paths are explicit local files; no production service is contacted. CLI uses actual current capture/registration time; callers cannot backdate it. Fixed clocks in library tests are synthetic, not production validation evidence.

## Preregistered validation specification

`alpha` (strictly between zero and one) and `statisticalPlanRef` are mandatory frozen fields. Opposing quotes supplied to the economic grade must be complete, reconstructable adapter results; a self-asserted PIT quote alone cannot create a paired baseline.

Protocol fields: `eventIds`, exact `population` slots (`eventId, sport, homeId, awayId, side, decisionAt, kickoff`), preserved `populationRef`, all four Phase 1 `patterns`, registry version, sports `[NFL,CFB]`, FULL_GAME_SPREAD / FULL_GAME, ONE_REGISTERED_SIDE_PER_EVENT, explicit `decisionSchedule`, `inclusionRules`, `exclusionRules`, `predictiveMetrics`, `economicMetrics`, `incumbentComparison`, `concentrationChecks`, `uncertaintyMethod`, source `freshnessPolicies`, `maxCaptureLagSeconds`, and holdout `{startAt,endAt,unseen:true,provenanceRef}`. Holdout must start after registration. `minSample` is at least 30 (a technical minimum, not evidence of adequate statistical power), correction BONFERRONI_FULL_REGISTRY, pushes SEPARATE_RETURN_STAKE, stopping FIXED_END_NO_EARLY_STOP. Freeze alpha/power assumptions in the preserved statistical-plan reference; do not choose them after outcomes.

Register the complete scheduled cohort, including nonmatching games and excluded quotes. Selection is frozen once per event before decisions; no selecting a better-priced side afterward. Preserve unsuccessful hypotheses and all exclusions. Missing/excluded entries block complete economic aggregates rather than disappearing from the denominator. Bootstrap event/season clusters; report team/season concentration, hypothesis overlap, quote completeness and failure rates. Primary conditional non-push log loss/Brier require independently validated exact-line probability mass; report push-mass calibration separately. Compare with exact-time incumbent and paired-book baseline, never a different line or later publication. Bonferroni includes all four registered hypotheses; any additional hypotheses need a new future protocol. Already inspected 2015–2024 NFL seasons and October 2026 examples are descriptive/training only, not unseen holdout.

The module freezes and checks the protocol; it does not execute cluster inference, fit probabilities or declare statistical significance. Phase 1 walk-forward validation is reusable only with audited complete PIT inputs. Formal power, concentration thresholds and chronological season splits require independent preregistration before monitoring begins. No real cohort or protocol is fabricated in this phase because source evidence is insufficient.

## Candidate, outcome and economic contracts

Canonical JSON envelopes contain contract/registry versions, source-code SHA, full canonical game and feature availability, exact market quote, original clocks, decision/capture clocks, frozen protocol, exclusions, research flags and SHA-256. Candidate capture must occur before kickoff within frozen lag for PROSPECTIVE_SHADOW; later captures are RETROSPECTIVE_RECONSTRUCTION. Hash reload reconstructs semantics, not just bytes. Source features, raw binding and identity retain original provenance. Unsupported features never become genuine neutral values.

Local artifact creation uses exclusive `wx`, fsync and read-only mode. Same retry is idempotent; changed evidence at the same logical slot fails. Pending grade artifacts and final grade artifacts are separate, and neither overwrites the candidate. Final grades bind candidate hash plus verified same-event final scores, completion and outcome-observation clocks. A prior pending outcome does not prevent a later final grade. Final corrections conflict rather than silently revising old economic results. Partial-file failures fail closed; offline administrative recovery requires preserving the damaged file and provenance, not automatically overwriting it.

This is write-once application behavior with tamper detection, **not immutable WORM infrastructure**, authenticated timestamping or protection against a filesystem owner changing clocks/bytes and rehashing coherent inputs. Preservation needs independently retained manifests and a trusted timestamp/signature or separately authorized immutable store before prospective scientific certification. Local tests do not demonstrate that trust infrastructure.

Economics remain research-only: exact-price conditional breakeven; paired no-vig only if Phase 1 exact event/book/opposite line/source-clock/provenance checks pass; push-aware EV only with validated win/loss/push mass at the exact entry and decision. Simulated one-unit profit uses preserved entry price after valid final outcome. Full-cohort aggregation rejects duplicate events/grades and missing entries/outcomes; drawdown is based on outcome-arrival order, not an execution portfolio. Nonmatching patterns retain final-outcome validation. Realized profit is always NULL. Conditional predictive losses exclude pushes and require audited line-specific mass. CLV remains NULL: terminal same-book closing attestation is absent and intentionally not implemented. Incumbent comparison remains unavailable without same-time paired prediction mass. Transaction costs, executable stake limits and bankroll risk are not asserted. Historical descriptive ATS rates never become calibrated probabilities.

## Example reconciliation

Tampa Bay–Dallas canonical event `401872980`: claimed away +9.5, book/price/publication/source clocks unknown. Stored Pinnacle away +7.5 at −106 captured October 6 18:46:09.771Z and −103 October 7 19:11:50.203Z. Washington–Iowa `401858487`: claimed Washington −2.5, book/price/publication/source clocks unknown. Stored Pinnacle home −3.5 at −104 captured October 7 19:11:56.356Z. These are different lines, not confirmation of the claims. Original provider clocks and raw references are absent in the odds table. No eligible final grade at either claimed offer is produced.

The prior Phase 1 independent factual audit remains separate: contemporaneous official Iowa notes described #20 Iowa 4–1 versus Washington 3–2; this supports an unranked-favorite research question, not the asserted cover record or offered line. Rest, public money, reverse movement, QB/injury effects and asserted historical percentages lack complete authenticated decision-time evidence. Later ESPN final/standings retrieval is not proof those fields were available at a historical decision. Do not tune any threshold to reproduce these two examples.

## Review, acceptance and remaining gates

Regression coverage includes original clocks, sign conventions, identity conflicts, exact TTL boundary, wrong periods/books/prices, post-start/future contamination, nonmatching cohort outcomes, duplicates, changed snapshots, pending/final separation, complete registered cohorts, rehashed semantic tampering and authority activation. Production formulas, registries, provider restrictions and schema are unchanged. Independent review must inspect final exact HEAD; a prior CI result is not current validation.

Technical acceptance is not an edge, qualification or production-readiness finding. Next gate is independent source/availability and canonical identity attestation, then trusted offline preservation, a genuinely future protocol and complete shadow observations. Missing evidence is a measurable blocker, not permission to invent it.
