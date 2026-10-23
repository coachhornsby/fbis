# Football simulation rankings — production replay recovery
Date: 2026-10-23.

The NFL/CFB rankings code, UI and read-only API were merged in PR #1575.
The exact merge SHA `6532d1df282b4e13191216811b905610fd1bab0b`
contained the correctly scoped one-shot replay marker, but its GitHub
main CI run #39955492899 was **cancelled** during concurrent repository
changes. Consequently the success-gated same-seed replay did not run.

Verified production CFB_DB lacked the additive
`cfb_drive_rankings_enrichment` table, so the CFB rankings endpoint could not
read old frozen V2 simulation metrics. Applied the **identical additive
CREATE TABLE IF NOT EXISTS** statement from
`sql/cfb/0003_cfb_drive_rankings_enrichment.sql` on the existing `fbis-cfb`
D1 using the Cloudflare administrative API. A follow-up D1 query confirmed
the table exists and contains zero enrichment rows pending replay.

This operations-only commit retriggers the existing
`.github/workflows/cfb-rankings-replay-once-20261023.yml` AFTER successful
main CI. The workflow re-executes the idempotent schema migration and replays
original 1,000-draw CFB games from precisely the originally observed sources,
original seed and baseline, validates the identical original final-score
statistics, and inserts only distinct research-only outcome tail summaries.
The workflow has no privileges to change the betting model or place wagers.

Required sign-off: completed successful replay action, zero pending replays,
CFB_DB row parity with original run receipts, and read-only rankings API
smoke success. NFL remains a parametric possession-path research generator,
not a trained or validated play-by-play NFL simulator; probability estimates
cannot be represented as price-calibrated betting edges.
