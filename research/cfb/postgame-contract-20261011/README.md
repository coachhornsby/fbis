# Offline postgame transaction qualification

This release extracts the offline postgame reference implementation from the unresolved recovery work without activating production routes, migrations, credentials or schedulers. It makes the correction/atomicity contract independently testable on current main instead of merging the stale108-file recovery PR.

Fifteen tests passed locally. They exercise both-team card and player-stat reconciliation, null availability, final-status discovery, overtime, season-aware FBS/FCS identities, duplicate final observations, time-aware athlete membership, incomplete sources, transaction failure/restart, stale correction rejection, paired-denominator rates, durable restart, immutable historical snapshots, and exclusion of retrospective or late-normalized evidence from pregame cutoffs. Chronological replay proves a second game affects future team features without rewriting a prior snapshot.

The reference ledger stores original observations, immutable game/card versions, current-version pointers, durable job states and a refresh outbox. Complete game versions and both card pointers are committed atomically. It has no model or wagering authority and does not infer participation from roster membership. This fixture qualification is not an automated production postgame service.

Production activation remains blocked on independent full remote backup restoration, approved0098/0099 contracts and live postflight, qualified source acquisition/participation completeness, a D1 transaction adapter, scheduler ownership, real provider-latency/load testing and independent end-to-end review. Special-case official results and comprehensive source-driven statistical reconciliation still require provider contracts. No15-minute publication SLA is claimed.

Exact execution: python test/cfb-postgame-rehearsal.test.py -v

Rollback: revert the offline code/workflow release. No production database changes are introduced. Retain existing recovery evidence. Acceptance: all15 fixture contracts pass in CI; production completion remains separately classified BLOCKED.
