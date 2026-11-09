# NFL additive budget activation

`planNflBudgetActivation` is a pure, offline planner. It cannot invoke collectors, inspect R2, deploy code or enable routes. It prepares six exact grants for the already reviewed source inspection/publication/verification and one dated output packet inspection/publication/verification.

The caller supplies the existing live policy, a matching application-ledger read no older than five minutes and explicit independently reviewed worst-case job/coordinator costs. Test cost values are fixtures, not production cost approval. The planner preserves all existing jobs, monetary allocation, expiry and existing unit ceilings. Missing NFL attempt counters and coordinator counters are added only at the exact six-operation aggregate. Existing counters cannot be increased or reused after exhaustion. A pre-existing NFL grant requires reconciliation rather than overwrite. Actual admission remains authoritative when execution starts; a successful plan does not reserve funds or guarantee headroom later.

Aggregate ceilings are six R2 reads, two conditional R2 writes, 27,213,824 R2 bytes, six coordinator calls, twelve coordinator storage gets and twelve coordinator storage puts. Provider requests, D1, listing and deletion remain zero. Each operation has one attempt and the certified 100 ms runtime. Fixed reservation IDs permit only one output date per allocation period. This is not a four-date rollout or a recurring reader.

Before applying a generated policy:

1. Integrate and review the source gateway, current consumer and output writer on current main. Do not deploy an older budget Worker that removes newer status/diagnostic RPCs.
2. Compare current policy with the policy used to plan. Stop on change; do not overwrite concurrent updates. Re-read ledger if older than five minutes.
3. Verify existing orchestrator bindings and authenticated operator transport. Do not expose/retrieve secrets or add an authentication fallback. Current bound-secret presence does not prove the launcher can authenticate.
4. Validate exact source envelope hash/receipt, pinned output date, predecessor ETags/hashes, source completeness, future-game gates and CPU enforcement. Plan expiry and launch markers independently; no retry after uncertain results.
5. Apply only the additive scoped grants while preserving the $8 internal stop, existing $0.50 cycle allocation and user $10 ceiling. Do not reinterpret application remaining funds as provider billing or free-tier proof.
6. Verify the deployed policy and runtime before bounded invocation. Enable/pin only the required operation; a source write is blocked until the coordinated consumer understands its envelope.

As of the Nov 9 control-plane check, the existing gateway had the correct archive and budget bindings and an ORCH secret name, but no NFL enable/hash variables and a 10 ms runtime limit. Production budget had 18 jobs and zero NFL grants. A read-only application-ledger check reported $0.390258 remaining reservation allocation. These are observed checkpoints, not permanent authorization or a promise of present headroom.
