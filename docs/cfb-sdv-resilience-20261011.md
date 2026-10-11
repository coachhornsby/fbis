# CFB SDV acquisition, rate resilience and visible rankings

Status: validated candidate, not deployed. Production approval remains separate.

## Root causes and changes

The slate handler's unconditional CFBD weekly lookup could throw after a valid ESPN slate and then retry CFBD in its failure handler. The candidate obtains seven bounded public ESPN calendar days first, caches the complete week for five minutes and reports partial-day failures. Verified FBS versus FBS identity filtering remains in every presentation path. Public schedules survive model/provider failures without fabricated projections.

All four production CFB HTTP paths (collegeApi, legacy cfbd, deep features and core schedule) now share a CFBD cooldown, respect Retry-After, serialize cold provider requests and deduplicate same-URL reads. After one 429, subsequent endpoint fanout stops. Existing response caches remain authoritative. No key rotation, quota evasion, paid activation or model coefficient edits.

## SportsDataverse coverage

The reproducible coverage audit acquired 39/39 registered data families, 273,228 rows and 144,210,485 bytes. Each asset has its exact URL, current acquisition time, complete SHA-256 and all-column missingness in the manifest. The 96 MB game-roster CSV requires the explicit larger offline bound. Do not fetch it from a Worker or normal website render. A separate offline Parquet audit validated 75,316 play-by-play rows, 28,631,891 bytes, all schema columns/null counts and season scope. The model-PBP 2026 asset returned 404 and remains unavailable. The 39-family CSV audit and raw-play audit are distinct; no unavailable model-PBP data is claimed. Officials and propbets are not claimed available.

Scheduled forward capture additionally preserves team summaries, weekly ratings and advanced team game logs. A new step verifies source hashes, retains all 783 team-summary metric fields, builds 373 non-rank candidate inputs per side and preserves future research feature snapshots. Every statistic stays unavailable when missing. The acquisition time does not become a historical PIT timestamp.

## Rankings and model coverage

The new read-only `/api/cfb-intelligence` uses SDV public summaries, independently of CFBD/D1 recovery. Board and Models expose all 138 FBS programs and 11 conferences, adjusted offensive/defensive/net EPA, success, pace, finishing drives, explosive and passing/rushing metrics, rank orientation, source sample counts, results, missingness and the full searchable statistical profile. Source hashes, acquisition time and methodology are visible.

Team ranks use SDV opponent-adjusted EPA; offense/net higher and defense lower are better. Ties share team rank. Conference comparisons are offensive-play-weighted means of member ratings, with contributing-team counts and within-conference variation. These are descriptive research ranks, not new champion coefficients. Season-aware 2026 identities apply; unknown participants fail closed. Results against non-FBS opponents remain in team statistical records. There are 93 teams with summary game counts behind source final counts; the UI labels this lag. Published summaries are not represented as complete postgame Team Cards.

Production still uses fitted A/A features, not every statistic. That fact is visible. The all-stat fixed-penalty ridge challenger uses training-only imputation/scaling, prior-week team summaries and chronological 2024/2025 holdouts. It loses to the simpler benchmark on both seasons. This is retrospective weekly reconstruction, not qualified historical PIT evidence; incumbent and economic comparisons remain unavailable. No promotion, wagering or improvement claim.

## Validation and exact release operation

Run `npm test`, `npm run build`, and the read-only hosted CFB evidence workflow. The handler integration test simulates CFBD 429 and requires exactly one provider request plus retained verified public game cards. Raw CSV parsing, duplicate identities, nulls, rank orientation, opponent records, source cutoffs, prospectively frozen orientation and public-calendar caching are tested.

Before production release: review exact PR head and passing hosted CI; verify main has no new numbered migration and both live D1 ledgers still end at 0097. This PR contains no numbered migration or production data import. Merge only this candidate, then verify the standard Pages release SHA and browser Board/Models rankings. Confirm real source sample counts and FBS-only cards. Confirm active production model hashes are unchanged and no bet eligibility appeared.

Rollback: revert the candidate merge through standard CI. Restore the previous CFB capture workflow if needed. No production database rollback is required because this change adds no production schema or imports. Existing immutable artifacts stay preserved.

Unresolved gates: full remote D1 restoration, recovery migrations/import, complete postgame publication, independent prospective/economic qualification and model-PBP availability and roster participation interpretation. Storage headroom and durable evidence retention must be checked before expanding scheduled raw-source collection beyond this candidate's six bounded assets.

PLATFORM LEARNING CANDIDATE: provider-wide Retry-After cooldown plus retained verified schedule cards. Other sports require their own provider contracts and outage tests before adoption.
