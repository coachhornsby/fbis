# Bounded Polymarket reference repair

Offline implementation only. No request ceilings, admission certificates, schedules,
credentials, trading authority, or new storage operations are added.

- Full-game moneyline, spread and total contracts may carry a complementary binding
  only when the same provider market supplies exactly one long and one short with
  genuine distinct outcome IDs. Both sides must resolve to complementary identities;
  spread lines must be opposite-signed, totals must share the same threshold.
- A complementary reference costs `1 - YES bid`, never `1 - YES ask`. Missing or
  invalid bids cannot supply it. Both references keep original capture/source clocks
  and non-executable flags. Public rows and tooltips preserve the derivation.
- New-mode basketball/hockey fixture reads use current and next Chicago day within
  the existing single ESPN request. Legacy behavior and football remain unchanged.
- New-mode CBB uses one rotating kickoff-window list and up to three matched unique
  event-slug detail reads, still at most four provider calls. Window rotation has
  stride one; detail rotation advances after a complete window/tag sweep.

Coverage is partial: the latest capture replaces the previous one and does not
accumulate a full slate. Tests use injected provider fixtures; they do not prove
live derivative availability or live ESPN range support. Same-slug list/detail
binding discrepancies still fail closed, including opposite metadata present only
in detail. A scheduled capture must contain verified paired identities before an
old one-sided reference can become two-sided.

Rollout must update the read gateway and Pages reader before the collector emits
new paired metadata. Preserve the gateway's existing authenticated budget-status
route. Deploy Pages from the final merged head including concurrent approved work,
not an old pinned build. Keep the already approved REST display flag explicit.
Validate on scheduled captures, without extra live probes or capture/history reads.
