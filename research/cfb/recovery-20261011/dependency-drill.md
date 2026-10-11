# Cross-file D1 recovery qualification

The accepted local restoration covers 266 tables, 29 foreign-key clauses and 3,286,209 source statements. The existing statement-boundary partitioner preserves bytes but does not establish import ordering safety. Each D1 file import is a transaction with enforced foreign keys; a deferred child reference cannot remain unresolved across completed imports.

The new offline dependency check reconstructs the exact exported table schema, reconciles the table scope against accepted counts, rejects cycles and unknown parents, and produces parent-before-child ordering. All 266 tables qualify for this graph; sqlite_sequence must be restored last, after autoincrement rows. Six regression tests cover adversarial ordering, cycles, missing parents, sequence handling and invalid reconciliation.

This is preparatory evidence only. It neither transforms the full export nor proves a remote restoration. Before importing, the full existing same-bookmark archive must be acquired and checksum-verified; every statement must be accounted for during any reordering; each staged file must pass an independent FK-enforced local transaction rehearsal. After supported imports into a fresh isolated database, compare every count, schema object, migration ledger and integrity result against the export bookmark. Do not compare against advancing production.

Production UUID b50c724c-903b-4241-8ce1-48d931e7a44c is never an import target. No new export or production write is authorized by this plan. Accepted report creation-time limitations remain unresolved. No production recovery, 0098/0099 execution or full-data remote drill is marked complete.

Rollback: stop at the first mismatch; retain evidence and any isolated partial target for diagnosis. This offline change needs no database rollback. Revert its code commit if necessary. Exact reproducible offline execution:

```sh
python test/cfb-d1-dependency.test.py -v
python scripts/cfb-d1-dependency-plan.py --reconciliation research/cfb/recovery-20261011/independent-reconciliation.json --output /tmp/fresh-dependency-report.json
```

Acceptance: successful graph qualification plus six tests. Remote recovery acceptance remains a separate operation and requires independent verifier evidence.
