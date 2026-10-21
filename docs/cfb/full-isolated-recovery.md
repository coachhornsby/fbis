# Existing-bookmark full recovery drill

This branch runs one controlled recovery of the previously archived five-part export. It does not create a production export or change production data, migrations, schedules, model coefficients, or wagering gates.

The tool checks all archived parts, the concatenated compressed archive, and the original decompressed SQL against the single accepted bookmark manifest. It restores all source statements locally, counts every table, checks schema, ledgers and foreign keys, and calculates typed content hashes for every row. It partitions original statements into bounded files in foreign-key dependency order, creates indexes before dependent inserts, and restores every file in a fresh local database with foreign keys enabled. Both row counts and complete content hashes must match before remote creation.

The remote target must be a newly created `fbis-cfb-full-recovery-20261011-<run-id>` database. Production UUID and the earlier rehearsal UUID are explicitly forbidden. Supported D1 init/upload/ingest/poll operations import each file sequentially. Complete counts, schemas, migration rows, foreign keys and content hashes are reconciled against the source bookmark. Integer cursors are transported as text to avoid JSON precision loss. Missing evidence or partial imports fail closed.

## Execution and acceptance

The dedicated branch push starts the workflow. Credentials use existing repository secrets. No cron or repeated collector is installed. A fresh runner requires at least 18 GiB scratch capacity. Every SQL file is at most 64 MiB; no statement may be split. Unsupported SQL, cycles, invalid identities or checksum mismatches stop execution.

Acceptance requires the remote journal status `VERIFIED_REMOTE_FULL_RESTORE_PENDING_INDEPENDENT_REVIEW`, all import parts COMPLETE, exact table counts, exact source schema apart from the explicitly recorded Cloudflare `_cf_KV` internal objects, zero foreign-key violations, matching complete row-content digests and matching both migration ledgers. Local SQLite integrity must be `ok`. Remote physical integrity is not claimed: the supported D1 checks establish logical reconciliation.

An independent verifier must review the complete artifact before production recovery acceptance. The unavailable original 603-part export and unknown export creation timestamp remain explicit limitations of the alternative archive. No migration approval is implied by running this drill.

## Failure and rollback

On failure, stop the workflow and retain its fresh isolated database and journal. Production remains untouched. Do not replay an uncertain ingest, reuse a target, or delete the archive. The journal records completed files and the last active bookmark; an operator must inspect this evidence before proposing a supported resume. Deleting the fresh rehearsal is optional separately reviewed cleanup after evidence retention, never an automatic rollback. No production rollback is required because production mutations are zero.

Artifacts contain JSON reconciliation evidence only. Raw SQL, SQLite files, tokens and private upload URLs must not be published in logs or artifacts.
