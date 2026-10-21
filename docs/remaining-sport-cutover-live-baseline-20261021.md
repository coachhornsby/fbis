# FBIS 11-sport live D1 cutover baseline — 2026-10-21

The production Pages deployment at the time of this read was `8dac3d715fe08e0175fb98e1b2eb776d07ce0cff`.

## Authority
NFL: `SPORT_DB_MODE_NFL=sport` and `SPORT_DB_STRICT_NFL=true`. CFB, NHL, NBA, MLB, Soccer, WNBA, CBB, Tennis, NPB, KBO: `shadow`. No new CORE approvals or production flips were made in this audit.

## Working-set database counts
| Sport | Sport D1 games | Sport D1 prediction_snapshots | PRIMARY prediction_snapshots |
| --- | ---: | ---: | ---: |
| CFB | 1184 | 10377 | 10377 |
| NHL | 178 | 748 | 748 |
| NBA | 168 | 402 | 402 |
| MLB | 730 | 2903 | 2903 |
| Soccer | 169 | 529 | 529 |
| WNBA | 11 | 48 | 48 |
| CBB | 0 | 0 | 0 |
| Tennis | 0 | 0 | 0 |
| NPB | 0 | 0 | 0 |
| KBO | 0 | 0 | 0 |

These are live count reads, not record-level equivalence, prefix-table parity, write ownership certification, or rollback qualification. Zero-row working sets cannot be treated as proof of complete source data.

## Sequence
1. CFB first: complete review of 40 PRIMARY-reference candidates, prove continuous delta and full-record parity for 18 CFB prefix tables and all ledger tables; verify no fresh-write split; reconcile post-cutover rollback; approve a time-bounded CORE receipt only after passing.
2. NHL next: goalie, OT/SO, empty-net and wager confidence model validity remain separate gates from D1 storage. Validate NHL read/write ownership, snapshot and settlement consistency before the authority switch.
3. NBA, MLB, Soccer, WNBA: finish individual table-schema and consumer ownership evidence; do not batch activate.
4. CBB, Tennis, NPB, KBO: investigate why shared working-set games and frozen projections are zero and verify their source-backed sport-specific tables; avoid empty-table parity acceptance.
5. For every sport: preserve NFL authority and other sports' shadow modes, maintain all 11 CORE board entries, verify direct Pages/Workers bindings, stage fail-closed strict mode, demonstrate reversible writes, and use production-only version-controlled promotion. Never delete legacy rows during authority migration, or conflate storage cutover with wager authorization.

**State:** NFL production, ten individual shadow cutovers still pending. No simultaneous activation authorized.
