# College refresh admission development

Status: offline development only. No new schedules or provider calls enabled.

## Verified operating constraints

CBB input lifetime is six hours from the real KenPom capture. The existing operator policy permits two attempts per America/Chicago day, with a three-hour cooldown. Failures consume attempts. Current generic GitHub jobs lacked this shared admission.

CFBD/CBBD share the existing atomic D1 governor: default 45 attempts per Chicago day, 1,400 per UTC month, provider-safe shared usage ceiling 67,500, remaining-call stop at 100, cooldown on 429, and one identical URL/query per Chicago day. The GitHub publisher previously counted only its own calls.

Read-only audit on November 9 found six November acquisition receipts and six CBBD usage calls. The recorded provider remaining count of 74,997 dates from November 2 and is not a current balance. Missing GitHub receipts must be reconciled with actual action evidence; a recent packet alone cannot prove how many attempts occurred.

## Admission implementation

CBB uses the existing conditional R2 attempt keys. The helper enforces two slots, the three-hour cooldown, Central dates and atomic claims. It refuses to reconcile a current legacy capture without independently verified unledgered attempt count. It retains original capture timestamps and never deletes claims.

Normal CBB admission: two R2 reads and one conditional write. Reconciliation of one proven unledgered capture adds two reads and one conditional write. These are operation counts, not dollar estimates.

CFBD admission must reuse the existing atomic D1 governor before every outbound request and record outcomes and provider quota headers afterward. No modified query may be used to evade duplicate detection. A storage or admission failure must stop the provider request.

## Cadence choices, not activated

Within the current CBB cap, two daily captures can provide at most twelve hours of current evidence and cannot cover all November 9 games continuously. That slate spans 16:00 UTC through 04:59 UTC the following day. Failures and scheduler delay reduce coverage further.

An illustrative full-slate plan is 12:20, 18:00 and 23:30 UTC, with six-hour lifetimes and a freshness check before every run. This uses at most three KenPom calls and six CFBD calls per day if both sources require actual refresh at all windows. Over 31 days that is 93 KenPom and 186 CFBD calls, excluding all other consumers, failed attempts, and any quota verification call. ESPN fixture reads and storage operations are additional. This plan exceeds the current CBB two-attempt policy and CFBD identical-query/day rule, so it is NOT enabled.

Keeping CFBD deduplication unchanged permits at most one daily PPA/completion pair (two calls, at most 62 in a 31-day month), providing only a six-hour freshness window. Verified frozen priors are reused with zero provider calls.

## Activation blockers

1. Reconcile actual unledgered calls without claiming a current account balance.
2. Verify current provider allowance and the account-level cost admission; no dollar cost is inferred from request counts or stored historical tiers.
3. Integrate durable admission into every competing trigger, including generic recovery and manual refresh, before enabling cadence.
4. Any higher-frequency policy requires an explicit, scoped decision. Keep current numeric caps, remaining-call stops and no-wager gates until then.
5. GitHub cron is not a hard deadline: the November 9 12:20 run did not appear on time. Monitoring should report delayed or missing results; a retry must use the same durable claims.

No timestamp extension, synthetic model inputs, paid plan changes, new credentials or expanded permissions are part of this work.

## CFBD adapter operation counts

The inactive adapter uses the existing governor without altering it. Two successful requests require twelve D1 HTTP requests and ten logical row mutations. Actual rows read/written are collected from Cloudflare response metadata; indexed scans and billing cannot be inferred from logical statement counts. It precharges usage before outbound IO, halts on unresolved reservations or accounting failure, and requires provider-balance evidence no older than six hours. Current November 2 balance evidence fails that check.

Thirteen combined offline tests cover CBB atomic claims and CFBD reservation, duplicate/cap stops, stale evidence, accounting failure, rate limiting and header outcomes. These helpers are not yet wired into production callers. Caller integration must verify any deployed limits lower than the defaults and account-level admission; the helper must not silently replace stricter deployment settings.
