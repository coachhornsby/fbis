# Polymarket REST repair: approval and rollout plan

Prepared locally only. Code publication was denied earlier and must not be
retried without materially new, specific user approval. This document grants no
authority to publish, merge, activate, deploy, change access or spend.

## First approval: publish for review, no deployment

Ask permission to push the local Polymarket pregame REST and identity-hardening
branch to coachhornsby/fbis and open a draft PR, including the offline-only CI
change. No merge, release workflow, production variable change or collector run
is included. Existing first-half CI contains three live provider probes; the
proposed CI removes all three and replaces them with injected-provider and local
emulator tests. npm package installation and GitHub Actions remain normal CI
activity; tests do not call live exchanges.

Before any push, inspect all currently applicable push/PR workflows on the final
head for deployment/provider-call side effects, not only the edited workflow.
Reconcile latest main, preserve PR #1909, independently review all new changes,
and run the exact resulting CI commands locally. A draft PR is not permission to
merge or deploy. Do not use the old broad first-half release workflow: it also
releases the roster publisher, WebSocket worker and Pages.

## Separate approval: narrowly deploy and enable

After draft review and green exact-head CI, request permission for an exact
reviewed commit to be merged and deployed to these two existing services only:

- Cloudflare Worker fbis-polymarket-rest-collector.
- Cloudflare Pages project fbis, including its existing exchange-quotes reader.

Explicit activation is setting FBIS_POLYMARKET_PREGAME_REST=true on those two
services. This replaces the collector's current discovery/staging mode with
pregame REST reference captures and selects those captures in the Pages reader.
It does not add a second data feed or an executable-price guarantee. Deploying
with the flag off leaves the new capture mode inactive.

Retain the existing two-minute collector cron and five-sport rotation. Each
collector job remains capped at four Polymarket GETs, one fixture read and one
capture write under its existing admission. Existing ESPN fixture refresh and
fixture archive admission remain separate; this is not a claim of only four
requests across the whole scheduled chain. Do not change account policy, cost
ceiling, job certificates, provider credentials, roster/stream workers or other
sport models. If admission rejects the operation, stop and report; do not expand
the policy or retry through another path.

## Ordered validation after explicit approval

1. Verify current deployed versions, flags, admission and rollback versions using
   authorized read-only configuration checks. Stop if the intended jobs lack
   admission or deployment would activate unrelated changes.
2. Release the reviewed collector with activation approved; observe its existing
   scheduled slots, without starting extra collection. Read at most one existing
   capture per active sport through an admitted path. Verify bounded receipts,
   fixture IDs, starts, contract/outcome bindings and reference prices. Record
   original capture times and partial-coverage metadata. Do not use private keys
   or direct unadmitted R2 access to get around read restrictions.
3. Only after relevant REST envelopes exist, enable the reviewed Pages reader.
   Check one relevant fixture per populated sport through existing quote reads.
   Missing captures, unknown source timestamps, stale references, closed-market
   invalidations and unavailable markets must remain explicit. No raw provider
   timestamp is inferred from retrieval time; no wager or projection authority.
4. Confirm existing scheduled runs, not just one manual result, continue to
   produce bounded evidence. Record verification time and which sports actually
   had upcoming fixtures; do not claim complete coverage from one rotating page.
5. If validation fails, use only an explicitly approved rollback of the two
   changed deployments/flags. Restoring flags does not erase archives. Do not
   compensate by enabling additional collectors, requests or budgets.

## Known limits

The pregame mode targets five active sports and future fixtures only, retains a
maximum 50-contract partial capture, does not accumulate all prior contracts on
the server, and publishes non-executable reference quotes. Source update times
remain unknown. Local simulator tests cannot prove production freshness,
provider response contents, credentials or live account-budget admission.

## Local review receipt

At preparation time, matching PR path filters selected only the Polymarket
first-half CI and CBB market explorer CI workflows. Both now use direct Vite
compilation instead of the package build command that acquires ESPN snapshots.
The former's three direct Polymarket probes are removed. Two structural CI tests
check these boundaries; they are not a network sandbox. YAML parsing, 90 focused
offline tests and direct Vite compilation pass. An independent reviewer found no
remaining blocker in these edits or this plan. Recheck workflow matching after
any rebase or scope change. No publication or release was attempted.
