# Soccer market identity and shadow adapter repair — October 15, 2026

Root cause: generic `games` held 82 soccer events, with latest kickoff October 15. Provider captures included October 16–17 events, so upcoming soccer markets could not match. ESPN's soccer scoreboard requires a single date, not a date range.

Repair:
- Independently read ESPN fixtures for today through +3 days over the ten routed competitions plus NWSL. At most 44 free schedule calls, cached hourly in R2. Ingestion uses both team names and a unique kickoff match; no provider numeric-ID inference.
- Append corrected identities to the immutable market ledger, preserving captured prices and provider/collection clocks. Old unmatched evidence remains intact. Post-capture links cannot become prospective economic evidence.
- Reconcile hourly and run a one-shot production proof on release. No additional paid PinnOdds capture is triggered.
- Subscribe the existing read-only Polymarket Worker to full market data. Official documentation identifies `marketData.transactTime`; lite messages omit it. Preserve real transaction timestamps, accept only open full books, and keep null when absent. Preserve first/second-half periods. Bind the long contract explicitly; old soccer socket records without verified contract binding are excluded from current card overlays.
- The shadow collector now reads PinnOdds and Polymarket references. Complete, coherent, recent, pre-kickoff, provider-timestamped PinnOdds 1X2/BTTS/O2.5/core Asian markets can populate economic fields. Exchange prices stay separately labeled references. Unknown clocks, missing draws, mixed captures, or later identity links cannot qualify.

No public model promotion or wager authority change. This is the market connection repair, not completion of the full Phase 3I calibration/closing-price/result-grading program.

Verification: focused tests and full npm suite passed; production proof results are recorded in the reconciliation workflow artifacts. See the associated pull request for deployment status.

Primary source for full-book semantics: https://docs.polymarket.us/api-reference/websocket/markets
