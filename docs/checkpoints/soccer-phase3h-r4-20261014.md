# Soccer Phase 3H-R4 checkpoint — October 14, 2026

Classification: **BOUNDED_REPAIR_REQUIRED**. The release is prepared on PR #1096; the fresh authenticated production proof remains pending merge/deployment. No Phase 3I scheduler was added.

## Verified live baseline

| Check | Observed result |
|---|---|
| Main SHA, latest check | `722448f349ac27d53842043efc0f044e724796aa` |
| Production deployment | `f5825501-3094-4347-b539-333a75047f79` |
| Production SHA | `722448f349ac27d53842043efc0f044e724796aa` |
| Production completed | `2026-10-14T05:33:24.810479Z` |
| Null-season fix ancestry | Earlier production/main `1c7a5f84...` was independently verified as descendant of `9b1202f6...`; latest main continued forward through other releases |
| Original deployment lag | Cleared before this repair started |
| Collector SHA | New authenticated collector summary not executed; no credential was exposed/reconstructed |
| Migrations | Soccer 0079 and 0081 applied |
| Routes | 50: 27 PASS, 17 PARTIAL_PASS, 1 FAIL, 5 INSUFFICIENT_EVIDENCE; 44 shadow eligible |
| Baseline prospective ledger | 20 rows, 1 event, 0 genuine-market rows, 20 unavailable-market rows |
| Baseline duplicates | 0 duplicate shadow IDs |
| Baseline flag violations | 0 |
| Latest proof evidence | October 7 snapshots for the now-expired October 9 slate |
| Core canonical history, one-year D1 query | ger.1 288; fra.1 287; esp.1 369 final matches before October 16 |
| Championship Stage B | 251 DONE shards, 2,878 persisted; updated October 9 |
| UEL history | 77 DONE shards, 817 persisted |
| Historical cadence | Existing queue drain remains every five minutes; independent of prospective proof |

The production data is real; the new production proof is **not yet run**. First/second timestamps, attempted/written/existing counts, same-bucket confirmation, new-row provenance, core projected fixture counts, and new competition/family counts remain pending. They must not be filled from the old proof.

## Reviewable repair

- Verified provider branding for 442 distinct clubs across 24 populated competition directories; exact competition-scoped names only, no substring identity guesses.
- Match cards retain soccer sport identity, crests, team colors, league, and v2/v3 diagnostics. Soccer projected scores use GOALS.
- Missing rest data no longer becomes zero-day evidence in matchup display.
- TEAMS adds 240 club entries across all ten immutable Soccer route competitions and preserves FBS profiles.
- Team profiles show acquired canonical history, recent results, sourced rosters, freshness and coverage. Successful roster snapshots are retained in R2, with stale fallback labeled.
- Advanced profiles show 35 PitchAPI metrics with per-field sample counts, opponent averages, last-ten averages, source observation date and match window.
- PitchAPI IDs and ESPN IDs are never equated. Exact normalized team names within the competition determine advanced-profile membership.
- Profile display has no persistent-state projection influence and no wager authority.
- One-shot uses the current Chicago date plus three days instead of October 9. It waits for the deployed trigger SHA, records fixture diagnostics, and requires nonzero successful ger.1 and fra.1 paths, distinct actual timestamps and same-bucket idempotency.
- No thresholds, coefficients, immutable routes, qualification flags or public authority changed.

## Deployment and validation

The first preview failed because the Pages-hosted older Functions bundler rejected JSON import attributes. Changed the branding directory to a plain JavaScript data module. Local Pages Functions build and the subsequent Cloudflare preview deployment succeeded.

Full standard test command: 1,582 passed, zero failed before the final advanced-profile additions. Advanced-profile, identity and reconciliation regression tests passed after those additions. Vite build passed. Browser verified club crest/color cards and Barcelona's advanced-data profile. Barcelona preview reported 90 advanced matches, 45 acquired canonical matches and 30 roster players. These are different acquired source histories, not claims of complete season coverage.

Independent Workers preview checks fail because their generic `wrangler preview` command lacks worker-specific entry/config. The Soccer Pages preview is successful; those checks should not be mislabeled as a Soccer model failure.

Automatic approval review rejected the direct default-branch push as a high-impact shared-repository mutation without explicit authorization for that push. Work was placed on a separate branch and PR instead. Production release requires explicit approval; it has not happened for this change.

## PLATFORM LEARNING CANDIDATE

The exact optional SQL predicate audit found the Soccer season guard already repaired and the shared observation-store requestedMaxItems predicate guarded against null.

A broader numeric-helper audit found `Number(null)` risk in `soccerPitchApiStore.js`'s `n(v)` helper. Browser reconciliation produced concrete evidence: Barcelona–Getafe `m_4HSsqt` retained raw full-match PitchAPI stats with `big_chance.home = 7`, while the stored big-chances metric had been zero. Profile presentation now reads that metric from the retained full-match raw source and flags stored/source mismatches; missing raw evidence remains unavailable. It does not silently rewrite model history.

Recommend a separate bounded ingestion-key/null-helper repair and a raw-source reconstruction audit before changing existing model evidence. Do not mass-edit predictive code or reinterpret all stored zeroes as missing.

## Governance and release gate

Public Soccer v2 remains incumbent. v3.1 remains a competition × family research challenger. Model-market separation, persistent-state influence OFF, qualification OFF and wager authorization OFF remain intact. UEL historical research remains retained and its advanced authority stays deferred.

After approved release, inspect every newly written row and verify all required field/provenance/market-null contracts. Do not declare PROSPECTIVE_SHADOW_READY unless canonical ger.1 and fra.1 paths pass in production and first-write/same-bucket idempotency are demonstrated. Only then provide the complete Phase 3I activation prompt.
