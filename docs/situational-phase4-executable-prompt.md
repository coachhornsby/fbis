# Next bounded build: native-response economic evidence feasibility

Execution mode: WORK.

Repository coachhornsby/fbis. Reverify current main, production, Phase 1 draft #930 HEAD d754f09c5dc56de4c6698b5dc578404fab5f971f and Phase 2 draft #931 HEAD 1e5ac9010be2e02778449d2403ab381a954addea. Phase 3 is the dedicated capture-readiness draft associated with this document; resolve its exact current HEAD and successful CI before work. Verified production/base at Phase 3 audit: d5d8499050c7ac0ce607d709baa234c4809678ec; Pages deployment e8132f07-8296-43ad-8200-73daab317665; migration0097. ACTION/PrizePicks BLOCKED and Apify ACCOUNT usage restricted. No automatic reopening.

## Profit mechanism

Preserve exact prices already obtained through an authorized source, so complete NFL/CFB candidate cohorts can be compared to the incumbent at real entry prices. This tests whether situational conditions provide incremental economic information and prevents phantom profit from missing clocks or substituted prices. It does not assert a positive edge.

## Cheapest viable scope

First obtain ONE complete existing native SharpAPI response plus its original contemporaneous receipt, provider timestamp semantics, market-state semantics, canonical mapping, and read-only account entitlement/quota/cost evidence. Use existing exports; do not make an additional acquisition call. If unavailable, inspect an existing The Odds API response under the same restriction. Provider last_update must be classified by actual documented semantics; no clock inferred from request time. No account credentials in artifacts.

Implement only an offline provider-specific mapping into Phase 2 evidence and Phase 3 audit contracts. Preserve raw bytes/hash, exact bookmaker/selection/spread/odds/period, original source clock, independently received time and OPEN/suspended state. Reject unsupported or ambiguous clock/state/sign fields. Keep original source data unchanged. No new tables, services or models. Canonical identity remains exact and reviewed.

A production raw-response tap is a shared production dependency and requires separate explicit authorization. Do not implement or activate it under this prompt. If offline feasibility passes, prepare a minimal diff and commands for operator review that reuse the existing authorized response, add zero acquisition calls, remain research-only, and freeze candidates through Phase 2. Costs must be verified rather than assumed free. Do not substitute another provider automatically.

## Tests and acceptance

Write deterministic tests for raw timestamp semantics, missing original clock, acquisition substitution, bookmaker/selection/line/period mismatch, suspension, partial payloads, late acquisition, duplicates, changed bytes, post-kickoff data and authority/provider activation. Reuse existing sealed-candidate tests. Run focused tests, complete standard suite, build, migration consistency, syntax and diff checks. Create a dedicated draft PR; exact-head TEST/BUILD must pass and DEPLOY/RELEASE remain skipped. Obtain independent technical review and correct material findings.

Feasibility passes only with at least one real quote backed by the inspected receipt and source semantics passing existing Phase 2 eligibility; synthetic tests do not count. Every rejected real row must retain deterministic diagnostics. Capture completeness must reconcile all input rows, including nonmatching and losing hypotheses. Report current provider costs, quota and additional request count exactly or UNKNOWN. No actual prospective candidate exists until frozen before results through the established contract.

## Economic experiment design

Do not set a profitability threshold from the two example games. Freeze a full chronological candidate/noncandidate cohort, included market and decision schedule before outcomes. Use an uninspected holdout. Estimate minimum sample size from a preregistered economically meaningful incremental benefit after exact-price vig/cost assumptions, event/season clustering and multiple-testing correction; report assumptions and power before starting. Preserve incumbent predictions at the same decision clock. CLV requires same-book matching close; EV requires validated line-specific probability mass; unsupported metrics stay NULL. Keep simulated versus executed economics separate.

## Abandonment and governance

Reject the source if original clocks, exact offer identity or active state cannot be established, source terms forbid preservation, zero-additional-request reuse is unavailable, or valid quote coverage cannot support the preregistered experiment at verified costs. Do not spend further effort reconstructing clocks. Return a negative feasibility result and the lowest-cost evidence access needed.

No merge, deployment, production D1/R2 writes, historical replay, paid acquisition, provider reactivation, model fitting/promotion, coefficient/threshold changes, new hypotheses or wager authorization. Stop consequential ambiguity on that issue and continue independent tests/documentation. Return exact HEAD/CI, inspected real sample counts, source decision, cost evidence, independent review and the single authorization required for any prospective hook.
