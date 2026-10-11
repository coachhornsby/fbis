# Durable postgame discovery and reconciliation contract

This offline implementation extends the tested postgame ledger. It does not install a production scheduler, query a provider, create a remote table or change model/wager authority.

Canonical season-aware identity and authoritative final status are mandatory. FBS versus non-FBS games remain in the intelligence queue even though public game cards are FBS versus FBS only. Reconciliation validates a whole acquired batch before changing state. Repeated final discovery preserves leases and error states. Delayed scheduler runs can still claim pending games from persistent storage.

Claims acquire bounded leases under an immediate SQLite transaction. Only the matching unexpired lease can report completion. Expired workers cannot publish completion; a later worker can reclaim the durable job. An official suspension/cancellation revokes completion eligibility. Reversal of an already verified official result is quarantined for review. Source/provider identity changes and conflicting same-time status records are rejected.

The caller may report a verified version only after the ledger has committed both cards and reconciled available verified player statistics. The integration test exercises transaction failure, durable restart, retry, two-card publication, a new correction version and immutable earlier pregame evidence. Production publication must enforce the lease within the same D1 transaction/pointer guard; this SQLite queue is not such an adapter. R2 archival, qualified provider adapters, D1 lease/load tests and outbox consumers remain required before activation.

Health checks now verify that both current cards actually include the latest committed game version. Existing pointers alone cannot hide a stale card after a correction. Queue health exposes pending finals, expired leases and quarantined games. It never equates successful workflow execution with complete data reconciliation.

Retry and correction intervals are bounded and configurable. Production qualification must establish lookback windows, source rate budgets, provider correction latency, historical audit cadence and measured publication objectives. No unbounded historical polling or new paid provider usage is activated.
