# CFB production cutover — controlled handoff receipt (DRAFT, NOT AUTHORIZED)
Checked on 2026-10-21 against live PRIMARY and `fbis-cfb` D1.

## Data work completed
- Working tables `games`: 1,184 / 1,184; `prediction_snapshots`: 10,377 / 10,377.
- All 18 CFB-specific prefix tables have count parity after inserting 171 missing `cfb_pregame_feature_vectors`. This does not establish row-level parity.
- Full-fidelity shadow replay through PR #1499; latest 75 games and 75 snapshots sampled with no non-payload differences. Immutable canonical evidence envelopes are intentionally treated separately.
- CFB legacy ledger: 3,178 predictions, 51,038 odds_snapshots, 10 team_form, 5 team_form_games copied into CFB D1, preserving original IDs and PRIMARY data. All four count totals match. Table DDL recorded in `sql/shards/cfb-v1-ledger-compat.sql`.
- Multi-sport ledger/strict approval foundation implemented in #1501 and #1502. CFB ledger readiness flag has **not** been set; CORE approval has **not** been issued.

## Open cutover gates
1. Classify 40 direct PRIMARY-reference candidate files from 2026-10-21 cutover owner inventory (#1500) into CFB-owned, shared CORE/market/operations, and unrelated references. Static candidates are not confirmed routing failures.
2. Route every CFB-specific read/write through a CORE-approved CFB_DB handle; preserve and document PRIMARY ownership for canonical market/CORE data.
3. Verify live consumer behavior and record-level changes for CFB working/prefix/ledger tables beyond counts, including new writes after this copy. Shadow CFB ledger currently lacks continuous delta copy.
4. Prove historical and post-cutover write recovery into PRIMARY (with a readback) without modifying unrelated sports.
5. Validate all 11 CORE board entries are current while NFL stays SPORT_DB and CFB switches, with CFB predictions/lines and settlement unaffected.
6. Obtain an independent, time-bounded CORE approval receipt, set `SPORT_DB_LEDGER_READY_CFB=true` only after audited ledger readiness, enable `SPORT_DB_STRICT_CFB=true`, then change only production `SPORT_DB_MODE_CFB=sport` through Wrangler with all 18 D1 and R2 bindings preserved.
7. Run deployment, live sport-authority read/write probe, CORE continuity, and rollback smoke. Preserve all legacy rows until retention qualification separately passes.

**Status: CFB SHADOW. No CFB authority or wager promotion has occurred.**
