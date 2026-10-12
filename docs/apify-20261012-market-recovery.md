# Apify acquisition and market integrity recovery — 2026-10-12

## Live evidence

Read-only Apify MCP audit saw 280 Actor runs across four Actors, zero failed statuses, and an Action Network dataset containing completed October 2024 games captured during an October 2026 run. Actor execution success must never be represented as fresh bookmaker data or successful FBIS ingestion.

Production D1 account review (2026-10-12 05:50 UTC):
- Apify provider cycle: 2026-10-12 through 2026-11-12.
- Provider reported usage: $0.05049426951596206 / provider limit $35.
- FBIS target $22 and hard cap $25.
- Account state **BLOCKED** / reason `APIFY_USAGE_LIMIT_REACHED`.
- Action and PrizePicks acquisition policies: **BLOCKED** / `ACCOUNT_RESTRICTED`.
- Governed `external_acquisitions` and `external_acquisition_consumers`: zero rows.
- Separate, legacy Actor runs are **not** evidence of governed acquisition or downstream consumption.

## Protections delivered

1. `isFreshComplete` rejects a provider's `asOf` later than the current clock. Stale and otherwise incomplete payloads continue to fail closed.
2. `latestVenueOffers` only returns observations within a bounded collection window; provider timestamps must independently fit that window if supplied. Completed-event offers older than 36 hours are excluded. Historical normalized rows are preserved, unchanged and available to separate research/settlement reads.
3. Account-health reconciliation reports remaining *effective* headroom under provider limit, FBIS target and hard cap while explicitly requiring manual authorization to lift historical account blocks. It never resets account state or starts an Actor.

## Recovery checklist — paid operations remain disabled until all pass

1. Revoke and replace the Apify token previously disclosed in chat. Update its secure GitHub/Cloudflare bindings using approved secret management; never paste or commit credentials.
2. Read current provider limits and verify the exact billing period and per-run metering; account-level usage includes actors outside FBIS.
3. Confirm the intended Actor input and output contracts using **real** current-date, independent provider evidence. Screen for stale event dates, pregame vs postgame timestamps, source vs collection clocks, unsupported sport/market responses, and bookmaker attribution.
4. Verify an authorized receipt trail: `external_acquisitions` captured hash and R2 raw archive, matching `external_acquisition_consumers` accepted/duplicate/rejected counts, plus normalized observations. A 200 HTTP response or SUCCEEDED run is insufficient.
5. With rotated secrets verified and operator authorization, activate only a bounded scope, leaving the $22 target/$25 hard cap and per-run, daily and hourly guards in place. Do not enable an unattended recurring paid task before one successful end-to-end receipt.
6. Run a prospective multi-sport shadow sample and compare against independent venue prices; keep unsupported ATP/WTA odds, NHL moneylines, CFB spreads/totals and other gaps explicitly unavailable until confirmed. No fabricated prices or synthetic source timestamps.
7. Model qualification and wagering permission remain separate governance decisions. ACTION stays outside `ODDS_PROVIDER_ORDER` pending independent evidence and an authorized provider promotion.

## Verification

- Run `node --test test/odds-provider-router.test.js test/market-observation-ledger.test.js test/external-acquisition.test.js`
- Run repository CI including migration validation and build.
- Inspect the release SHA and production logs after deployment.
- Verify fresh markets in the board and check absence of stale or future timestamps.
- Verify `/api/apify-account-refresh` response reads `manualReauthorizationRequired` without changing account state.

## No changes to

No increased spending caps, vendor cancellation, model weights, bet authorization, provider promotion, data backfill/rewrite, Apify schedule modifications, or D1 production mutation in this patch.
