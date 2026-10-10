# Situational Edge Discovery Phase 3

Research only. No source acquisition, production storage, model changes or wager authority. Phase 3 depends on draft PR #931 (`1e5ac9010be2e02778449d2403ab381a954addea`), which depends on draft #930. Neither is merged. The Phase 3 delta is the offline capture audit, CLI, tests, documentation and evidence. No historical recovery writer was implemented because no qualifying evidence was found.

## Verified checkpoint and scope

At 2026-10-10 03:51–04:00 UTC main and Pages were `d5d8499050c7ac0ce607d709baa234c4809678ec`; production deployment `e8132f07-8296-43ad-8200-73daab317665` succeeded. D1's canonical tip was `0097_apify_acquisition_authority`. Read-only query responses record zero rows written and changed_db=false. ACTION and PrizePicks were BLOCKED/ACCOUNT_RESTRICTED; Apify BLOCKED/APIFY_USAGE_LIMIT_REACHED. No restrictions were changed.

Exact SQL, object keys, metadata and timestamps are in `docs/evidence/situational-phase3/`. Responses are preserved as returned by the connectors. These files are reproducible evidence records, not immutable external attestations. Their Git history preserves the reviewed version; Git hashes alone do not prove original bookmaker availability.

## Provenance results

| Population | Total / inspected | Original provider clock | Independently verified historical offers | Finding |
|---|---:|---:|---:|---|
| ACTION NFL book ledger | 13,089 / aggregate complete | 0 | 0 | PROVENANCE_INCOMPLETE; NULL clocks cannot become collection clocks |
| ACTION CFB book ledger | 37,374 / aggregate complete | 0 | 0 | PROVENANCE_INCOMPLETE |
| Parent shadow observations | NFL 430, CFB 1,148 / aggregate complete, four latest envelope samples | no established book quote clock | 0 | Transformed research fields, not original complete response |
| Optional gameDetail | NFL 4, CFB 3 / all top-level structures inspected | no original book contract established | 0 | Players, depth charts, trends, rankings, weather, articles; not a complete original book-market capture |
| R2 raw/action/ prefix | 5 listed objects / 5 authenticated body attempts | UNKNOWN | 0 recovered | All body requests failed in client with `Cloudflare API error: 200`; objects are listed, not absent |
| Repository ACTION fixtures | 3 files, 1 CFB / complete JSON inspection and hashes | not independently attested | 0 | Synthetic regression fixtures; not historical offers |
| Attached ZIP | 237 file names inventoried | not independently attested | 0 verified | Older user archive; no contemporaneous NFL/CFB quote proof established |

Book-to-parent joins have zero orphans for both sports. This establishes relational presence, not correct canonical identity or original availability. Book-run aggregates date to September (CFB September 14–18; NFL September 14–24). The five raw/action objects date October 4–7 and their run IDs do not match the September book runs. Do not assume their content recovers those records. R2 listing used per_page=1000 and returned five objects; other prefixes and inaccessible archives are outside this inspected coverage.

The complete October objects remain uninspected: source rows, field semantics, raw hashes and price/time validity are UNKNOWN. ETags, archive timestamps and `immutable:true` custom metadata do not establish original quote time, sportsbook executability or storage immutability. Initial gameDetail body inspection was client-truncated; only the subsequent complete top-level JSON inventory is relied on. No checksum is claimed for an unavailable or truncated body.

Historical recovery output: **zero eligible observations**. This is a negative result within inspected coverage, not proof no recoverable evidence exists elsewhere. Missing access is an access blocker. Minimum additional access: read-only complete exports or presigned GETs for the exact five listed keys, plus contemporaneous receipt/provenance records for the actual September run IDs. No credential, permission or production changes are needed for a supplied read-only export. Stop searching absent that evidence; do not reverse-engineer clocks from results.

## Offline implementation

`node scripts/situational-capture-audit.mjs LOCAL_INPUT.json` reads local strict JSON and emits deterministic diagnostics. It cannot call providers, persist candidates, acquire credentials or activate authority. Input contains `entries`, externally `reviewedReceipts`, and optional source-readiness flags. Each entry supplies the existing Phase 2 record/context, exact raw body, capture identity, ORIGINAL_CAPTURE or RETROSPECTIVE_ARCHIVE origin, and raw-bound market-state path plus documented state semantics.

The Phase 2 adapter remains the quote-eligibility gate. The added audit checks exact raw hash, valid source references, unique capture IDs, independent reviewed receipt binding, separately established first availability and provider clock authority, and OPEN state bound to the same payload. Class A requires all quote gates and reviewed original availability; B is capture-time verified only; C is retrospective archive only; D is unverifiable. B/C/D keep quotes NULL. Every output carries false research authority flags.

Receipt fields are **external trust inputs**, not self-authenticating certificates. A boolean, hash or URL cannot independently prove time. The auditor must inspect the referenced timing authority and capture records before adding a receipt to the reviewed registry. Tests use explicitly synthetic receipts; the real audit supplied no qualifying receipt. The function never labels an offline finding as a frozen prospective candidate: prospectiveReady=false and candidateStatus=NOT_CREATED. Actual candidate freezing and append-only outcome linkage remain exclusively in the established Phase 2 contract.

## Prospective source and cost decision

| Option | Existing mechanism / limitations | Economic decision |
|---|---|---|
| Existing Phase 2 gate plus offline Phase 3 audit | No provider calls or production changes; prevents invalid entry-price research | RETAIN |
| Reuse an already-authorized SharpAPI native response | Natural production refresh observed NFL 28 / CFB 65 games at 03:48 UTC; normalized cache drops original source clocks/state/raw. Counts are feed coverage, not candidate frequency. Exact offers, timestamp semantics, suspension state, account terms and execution accessibility unverified | TEST only after bounded shared-hook authorization and evidence verification; no additional requests |
| Reuse existing The Odds API response | Configured credential boolean only; parser discards raw provenance. Provider docs define market last_update as provider's last observation, not necessarily bookmaker-native time. Exact account costs, quota and access UNKNOWN | TEST offline export first; defer any live activation |
| Existing Parlay / TheRundown response | Current normalization may substitute request-time asOf or discard price clocks/state; configured does not mean approved quota or executable offer | DEFER until complete native response and current account terms are verified |
| Recover missing ACTION clocks from collected_at, file time or archive metadata | Cannot establish original observation / availability | REJECT |
| New paid calls, blocked-provider reopening, blended odds platform, new model or hypotheses | No verified economic benefit demonstrated; exceeds authorization | REJECT for this phase |

All actual provider marginal costs, subscription entitlements, maintenance costs, candidate frequencies and current executability are UNKNOWN. Reusing the same response can avoid additional paid request count; this is conditional, not a claim all infrastructure is free. Current health reported free-cache fallback and liveCollectionHealthy=false. It cannot substitute for source/time/cost proof. Credentials were inspected only as configured/not-configured booleans; none were exposed. No native external provider endpoint was called by this investigation.

Official semantics references: https://the-odds-api.com/liveapi/guides/v4/ ; https://therundown.io/blog/sports-betting-odds-api . Documentation is not verification of account permissions, current payload coverage or executable bookmaker offers.

## Economic usefulness

This implementation can reject financially misleading entry prices before research simulation and reduce speculative historical-recovery effort. No new real quotes passed the gate. Historical or prospective ROI, EV, paired-book no-vig probability, executable edge, CLV, calibrated cover probability and incremental incumbent value remain NULL/unproven. Same-book closing observations and validated line-specific probability mass are still required. A benchmark quote can help compare against the incumbent without proving realizable profit.

## Validation and independent review

22 focused capture tests cover clock substitution, original availability, payload/reference mismatches, event/book/period/sign errors, late availability, duplicates, archives, partial bodies, post-kickoff quotes, provider blocking and authority injection. Existing Phase 2 tests exercise real candidate freeze/mutation/reload, stale prices, future features and outcome linkage. Do not duplicate the candidate writer. Independent review identified malformed HTTPS references accepted by the first parser; two tests failed before correction. URL parsing now requires hostname, HTTPS, no credentials and no whitespace. Full-suite and exact-head results are recorded in the PR and final verification report.

No migration or schema change, model math, source policy, production writer, projection routing or wager authority changed. Merge and deployment remain STOP.
