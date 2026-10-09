# Situational Edge Discovery — Phase 1

Research-only offline prototype. No production imports, routes, schedules, schema, provider calls, persistence, promotion or wager authorization. These hypotheses are not betting recommendations. No probabilities are fabricated from expected margins or historical hit rates.

## Reused components

`functions/lib/canonical/economicGrading.js`: pure American-price conversion and no-vig paired baseline. Input validation precedes use. `functions/lib/nflVerseFeed.js`: CSV parser only. Existing normalized-market ledger (migration 0095) is a possible future read-only adapter: retain original event/book/selection/line, source-observation/acquisition clocks and provenance. Its write/authority functions are not invoked. Existing NFL walk-forward and research-validation infrastructure informs the chronological design; no fitting or promotion is run.

## Post-review evidence hardening (October 9, 2026)

- Every game in the locked holdout cohort, including pattern nonmatches, now requires a verified FINAL outcome with validated post-kickoff completion/observation clocks and nonnegative integer scores. Nonmatches cannot silently bypass the cohort outcome contract.
- Direct economic functions require a caller-supplied source-specific `maxQuoteAgeSeconds`. PIT attestations alone do not make an indefinitely old price executable. Odds must be integer American prices; no missing or decimal American prices are coerced.
- Research cards publish only condition-relevant, PIT-attested feature records and a restricted primary quote record. Unrelated source payloads or future result fields cannot accidentally appear inside a candidate card.
- Read-only production audit: Pages production success at SHA `d5d8499050c7ac0ce607d709baa234c4809678ec`; D1 migration tip `0097_apify_acquisition_authority.sql`. `action_market_book_observations` contains 13,089 NFL and 37,374 CFB rows, **zero with `provider_timestamp` populated** in either sport. `normalized_market_observations` contains 126 Tennis rows, no NFL/CFB rows. These counts describe storage coverage, not historical quote validity, bookmaker comparability, or complete production-chain health. `collected_at` is not a verified provider observation clock.
- A future source adapter must preserve original quote clocks and capture-level provenance, produce an auditable immutable cohort manifest, and prove that each requested record was available before the research decision. Existing captures with unknown original clocks must remain `RETROSPECTIVE_UNVERIFIED`; no reconstructed clocks or assumed odds.
- This remains a draft offline prototype. None of the changes authorize a merge, deployment, new paid data acquisition, provider reopening, model qualification or wagering.

## Executable contracts

`research/situational/discovery.mjs` is pure. `scripts/situational-discovery.mjs` reads local files and prints JSON. Run:

```
node scripts/situational-discovery.mjs shadow LOCAL_SHADOW_INPUT.json
node scripts/situational-discovery.mjs validate LOCAL_VALIDATION_INPUT.json
node scripts/situational-discovery.mjs nfl-descriptive LOCAL_NFLVERSE_GAMES.csv
node --test test/situational-discovery.test.js
```

Shadow input: `{games: [...], contract: {maxQuoteAgeSeconds: N}}`. Each game has `sport`, canonical `eventId`, `side` (HOME/AWAY), explicit UTC/offset `kickoff`, `decisionAt`, verified identity with distinct home/away IDs and provenance. Each used feature/quote has the same event ID, `source`, original `observedAt`, independently proven `availableAt`, `provenanceRef`, `pitVerified: true`. The flag is a caller/adapter attestation, not independent verification performed by this library. Retain referenced immutable captures; setting the flag alone does not establish historical validity. Later archive retrieval is not original availability.

Features: `rest` and `opponentRest` are nonnegative integer provider-defined calendar days; `record` is `{games,wins}` from completed prior games only; CFB rankings are `{ranked:false}` or `{ranked:true,rank:1..25}`. Missing rank is not unranked. Dates without offsets, invalid calendars, sub-millisecond precision, offset beyond ±14:00, missing clocks and future observations fail closed. No clock skew allowance. Observation ≤ availability ≤ decision < kickoff. Original clocks remain unmodified.

Quotes require FULL_GAME_SPREAD, exact selected side, signed selected-team line, named bookmaker, finite American odds ≥ +100 or ≤ -100, source-specific explicit maximum age. Exact age boundary is inclusive. No source freshness policy is guessed. Quote absence does not prevent a non-market situational hypothesis, but the card explicitly marks its market comparison UNAVAILABLE. Opposing paired quotes must share event, book, market, exact opposite line and observation clock, with separately valid provenance.

Validation input: `{rows:[{game,maxQuoteAgeSeconds,oppositeQuote,outcome}], analysisPlan:{minSample,alpha,registeredPatternCount,registration,holdout}}`. Registration requires all cohort event IDs, the full pattern list, a locked timestamp preceding the holdout, `pitVerified:true` and an independently preserved reference. Holdout requires explicit start/end clocks, `unseen:true` and reference. CLI evaluates the entire cohort, never a caller-selected per-pattern subset. Nonmatching conditions are counted separately. Outcome requires the same event ID, FINAL status, source/reference, verified final scores, a completion timestamp after kickoff and observation timestamp no earlier than completion. One independent event unit per pattern; duplicate event units reject evaluation rather than inflating samples. Caller must provide the complete preregistered cohort, not only successful games. No module can prove completeness, unseen status or attestation truth from self-reported JSON; independent audit of referenced manifests remains mandatory. Model qualification remains false regardless of statistical result.

`economics` performs research arithmetic only. It requires genuine offered price; reports conditional breakeven given a non-push. Push-aware EV uses supplied win/loss/push mass summing to one at the exact same event, side and line, with explicit research model and validation reference. A fixed decision clock, valid mass observation/availability and validation-availability cutoff are mandatory for EV; both quotes require valid point-in-time provenance for a paired baseline. That function cannot independently certify external model calibration or self-reported provenance. A hit rate is never used as a calibrated cover probability. Absent independent probability mass → EV unavailable. Pair mismatch → no-vig baseline unavailable. No invented prices, stake recommendations or edges.

## Fixed hypothesis registry and feasibility

| Family | Phase 1 implementation | Missing gate |
|---|---|---|
| Relative rest disadvantage / short rest ≤5 days | Shadow predicates; NFL archival diagnostics | Verified prior event availability, provider rest definition, current canonical adapter |
| Winless after ≥3 prior games | Shadow predicate; chronological archival record reconstruction | Point-in-time result availability and independent records |
| Unranked CFB favorite vs ranked opponent | Shadow predicate | Timestamped poll edition; canonical CFB history; exact offered quote |
| Travel / schedule compression combinations | Unavailable | Verified venues/timezones, prior kickoff series, travel assumptions; no invented flight itineraries |
| Public vs market disagreement | Unavailable | Authenticated publisher, ticket/handle denominator, sample size, contemporaneous quotes |
| Reverse line movement | Unavailable | Same-book chronological quote series and contemporaneous public data; snapshot is insufficient |
| QB/injury adjustments | Unavailable | Canonical athlete identities, original report clocks, starter status, credible attribution versus correlated news |
| Recent competitiveness and ATS | Descriptive records only | Frozen rolling-window hypothesis and pregame quote provenance |
| Combinations | Disabled | Preregistered bounded search family, overlap/selection controls |
| Incumbent versus market | Unavailable | Immutable pregame incumbent cover mass at exact line; expected margin is insufficient |

## Statistical and economic interpretation

The validator rejects invalid PIT inputs, duplicate game units, missing same-book paired baseline and insufficient sample size. It calculates a conditional-non-push Poisson-binomial upper-tail test against heterogeneous no-vig market baselines. Bonferroni adjustment uses the complete preregistered family (at least the four declared patterns), including unsuccessful hypotheses. Pattern overlaps are disclosed; correction does not establish independence. Output RESEARCH_SIGNAL_REQUIRES_UNSEEN_VALIDATION is a screening result, not a qualified strategy. Conditional push behavior, correlated games, selection completeness and changing market composition remain validation risks.

Per-unit net return uses real supplied prices and actual ATS results, with pushes returning stake, one-unit stakes and no transaction-cost deduction. It is descriptive simulated arithmetic, not executable profit. This release does not estimate calibrated probabilities, CLV, confidence intervals for profits, or incremental incumbent value without the required immutable data.

`nfl-descriptive` is explicitly RETROSPECTIVE_UNVERIFIED. NFLverse archival fields have no retained bookmaker/quote/availability clocks in this file. Team-game cohorts can overlap (both teams on short rest); do not treat them as independent binomial trials. Missing scores/lines are rejected or counted; no zero/-110 substitution. No p-values, economics or qualification are produced by that adapter. Source `spread_line` is positive for the home favorite; selected-home spread negates it.

## Chronological validation plan

Register conditions, null hypotheses, full tested family, exclusion rules, sample floor and market families before examining holdout results. Diagnostic seasons 2016–2020 may generate hypotheses, 2021–2023 may develop/calibrate them, 2024–2025 are untouched final holdouts only if not previously inspected for selection. Those dates are a proposed split, not a claim that supplied data is unexamined. If researchers have seen the holdout, reserve a genuinely unseen prospective season instead. Never tune to the two example games.

Walk forward: fit/select only on earlier seasons and outcomes already available before the next fold decision; `chronologicalFolds` rejects missing/late training clocks even if season labels suggest safety. Freeze pattern definitions and probability calibration within each fold. Retain all candidates, rejected inputs and nonqualifying games. Use event-clustered/resampled uncertainty, overlap matrix and family-wide correction; evaluate selection sensitivity and team/season concentration. Paired immutable incumbent predictions are necessary for incremental log loss/Brier/calibration and economic comparison. Compare unconditional push mass separately, not as losses. Real same-book entry and close quotes are required for CLV; closing prices cannot enter discovery features.

No historical PIT validation is claimed until complete original availability and quote provenance are established. Fitting and qualification require separate approval.

## Evidence-card specification

Card fields: version, canonical event/teams, sport, kickoff/decision clocks, research-only authority, selected side, exact condition values/units and capture references, original observation and availability clocks, explicit missing families, quote/book/line/price or UNAVAILABLE, sample and season coverage, SU/ATS wins/losses/pushes, exclusions, overlap and multiple-testing family, market baseline and probability uncertainty, calibrated mass/EV/CLV availability, fold results and incumbent comparison. Present hypotheses, not picks or executable instructions. Never replace missing market/probability information with zero edge. Historical cards remain labeled historical; reloading one does not make its quote current.

## Example-verification limits

October 8 TB–Dallas: independent ESPN final 24–16 Tampa Bay; archival nflverse lists Dallas-favorite magnitude 9.5 and away price -112, both teams rest=4. TB+9.5 would cover by 17.5 if that exact line was actually offered. Quote/book/post-time availability is not established; equal rest is not relative rest disadvantage. Archived quarterback names require independent corroboration, not blind acceptance.

October 9 Washington–Iowa: official team information before kickoff shows Washington 3–2 and Iowa 4–1, Iowa ranked #20 in AP. Official kickoff publications differ by five minutes; retain the discrepancy instead of silently choosing a time. An authenticated -2.5 quote and exact Rigged Gems posts/statistical claims were not provided or located. These facts do not establish mispricing, cover probability, public percentages or a validated trend. Source assertions about historical streaks are not independently reconstructed evidence.

Read-only D1 case inspection found different captured Pinnacle lines: Tampa Bay +7.5 (-106 on October 6, -103 on October 7), Washington -3.5 (-104 on October 7). These are actual persisted captures, not proof of the claimed +9.5/-2.5 offers; the table records capture time rather than separate provider observation time. The latest Washington capture on October 9 contains moneylines, not a new spread. Neither old spread should masquerade as the current market. No normalized NFL/CFB observations exist in the queried normalized ledger; it contains only 126 Tennis consensus rows. No ACTION shadow rows matched these two exact canonical event IDs. This is a bounded inventory, not proof that every archive lacks evidence.

Sources: [nflverse games](https://github.com/nflverse/nfldata/blob/master/data/games.csv), [official nflreadr field dictionary](https://github.com/nflverse/nflreadr/blob/main/data-raw/dictionary_schedules.csv), [ESPN NFL event 401872980](https://www.espn.com/nfl/game/_/gameId/401872980), [Iowa October 5 team notes](https://hawkeyesports.com/news/2026/10/5/notes-friday-night-at-washington), [Washington game center](https://gohuskies.com/game-center/25203), [ESPN CFB event 401858487](https://www.espn.com/college-football/game/_/gameId/401858487). Original post text and publication clock are still required for exact influencer-claim verification.

### Actual archival diagnostic run (2016–2025)

2,639 completed NFL regular-season games; no thresholds were fitted. The cohorts are team-game units and can overlap; the strict validator separately requires unique event units.

| Fixed condition | Team-games | SU W–L–T | ATS W–L–P | Missing line |
|---|---:|---|---|---:|
| Less rest than opponent | 934 | 466–464–4 | 462–455–17 | 0 |
| Rest ≤5 days | 337 | 169–168–0 | 163–162–12 | 0 |
| Zero prior wins after ≥3 games | 134 | 46–87–1 | 69–62–3 | 0 |

These are descriptive counts, not verified profitable patterns. Historical validation, calibrated cover mass, executable EV, CLV and incremental incumbent value remain unavailable. Washington/CFB trend claims cannot be independently reconstructed from the available NFL file.

## Next gates and roadmap

1. Independently review this offline component. No merge/deployment authorized.
2. Read-only NFL canonical/PIT adapter with retained quote captures, chronological prior records and frozen incumbent packets. CFB adapter follows schema recovery separately; do not depend on unmerged migration 0098.
3. Immutable polls, real injury/starter updates, venue/rest clocks and authentic quote histories; public percentages only with authenticated source and denominators. No blocked provider reopening implied.
4. Register and run chronological NFL/CFB experiments; independently audit all exclusions, overlaps and result lineage. Prospective shadow monitoring produces non-executable evidence only.
5. NHL extension only after regulation/final targets and research-kernel scorer parity are resolved; never reuse football ATS semantics for hockey.

Before any market-family qualification: complete PIT lineage; stable identity and settlement targets; independently held-out calibration and economics at executable prices; sufficient sample/uncertainty; incremental incumbent comparison; prospective immutable evidence and CLV; separate governance decision. No authority changes in this PR.
