# Soccer market identity and shadow adapter repair — October 15, 2026

Root cause: generic `games` held 82 soccer events, with latest kickoff October 15. Provider captures included October 16–17 events, so upcoming soccer markets could not match. ESPN's soccer scoreboard requires a single date, not a date range.

Repair:
- Independently read ESPN fixtures for today through +3 days over the ten routed competitions plus NWSL. At most 44 free schedule calls, cached hourly in R2. Ingestion uses both team names and a unique kickoff match; no provider numeric-ID inference.
- Append corrected identities to the immutable market ledger, preserving captured prices and provider/collection clocks. Old unmatched evidence remains intact. Post-capture links cannot become prospective economic evidence.
- Reconcile hourly and run a one-shot production proof on release. No additional paid PinnOdds capture is triggered.
- Subscribe the existing read-only Polymarket Worker to full market data. Official documentation identifies `marketData.transactTime`; lite messages omit it. Preserve real transaction timestamps, accept only open full books, and keep null when absent. Preserve first/second-half periods. Bind the long contract explicitly; old soccer socket records without verified contract binding are excluded from current card overlays.
- Cards show PinnOdds as LAST CAPTURE for up to seven hours with explicit older-capture labels; this never refreshes clocks or makes an old capture current. Soccer exchange headline probabilities require full-game moneyline contracts.
- The shadow collector now reads PinnOdds and Polymarket references. Complete, coherent, recent, pre-kickoff, provider-timestamped PinnOdds 1X2/BTTS/O2.5/core Asian markets can populate economic fields. Exchange prices stay separately labeled references. Unknown clocks, missing draws, mixed captures, or later identity links cannot qualify.

No public model promotion or wager authority change. This is the market connection repair, not completion of the full Phase 3I calibration/closing-price/result-grading program.

Verification: focused tests and full npm suite passed; production proof results are recorded in the reconciliation workflow artifacts. See the associated pull request for deployment status.

Primary source for full-book semantics: https://docs.polymarket.us/api-reference/websocket/markets

Production verification: release 78a8f5cffe063cf6f00bfc26635f3480de879050 deployed successfully. Reconciliation run 38690395212 appended 1,472 Polymarket observations across 36 soccer events, retaining original clocks. Three one-shot shadow batches wrote 110 rows; 20 carried market references, none qualified for economic evaluation, and governance violations were zero. The new full-book Worker has persisted real provider transaction timestamps.

Follow-up: soccer prematch PinnOdds raw capture existed but no normalized snapshot had completed. Bound soccer prematch normalization to independently verified fixture identities, retaining every returned market for selected fixtures and all excluded provider events in the immutable raw archive. Public status exposes the scope and excluded counts. Replay the already-paid capture with zero additional provider requests. Also classify Polymarket DRAWABLE_OUTCOME/full-time-winner contracts as moneyline, name the actual team/draw rather than generic yes/no, and prioritize upcoming open contracts over completed markets in stream selection.

The prematch replay prepared 17,806 observations for 80 selected parent events (15,816 linked selections; 1,423 excluded provider events retained in raw). A transient D1 network loss interrupted the first replay after 2,400 completed inserts. Recovery now retries only idempotent ingestion operations and writes bounded 100-statement D1 transactions; no capture/reservation endpoint can be invoked by the retry helper. Existing keys and original clocks remain unchanged.
