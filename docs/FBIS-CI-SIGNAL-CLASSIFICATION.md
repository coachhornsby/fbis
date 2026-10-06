# FBIS CI Signal Classification

This document defines operational labels for fail-closed infrastructure outcomes. Labels improve triage only; they do not convert a failed safety gate into success.

| Class | Reason | Meaning | Required behavior |
|---|---|---|---|
| `EXPECTED_FAIL_CLOSED` | `SUPERSEDED_SHA` | A research job captured one live production SHA, then production advanced before the write phase. | Keep the job failed. Perform no mixed-SHA writes. Treat a later run on the live SHA as authoritative. |
| `INFRA_FAILURE` | `PRODUCTION_SHA_UNAVAILABLE` | The live deployment SHA could not be read reliably. | Keep the job failed. Block writes and investigate health/deployment visibility. |
| `CODE_OR_TEST_FAILURE` | workflow/test-specific | Build, test, syntax, migration, application, or other validation failure not matching an explicitly classified fail-closed condition. | Investigate as a genuine defect until proven otherwise. |

## Contract

- Classification is observational metadata only.
- `EXPECTED_FAIL_CLOSED` still exits nonzero.
- No classifier may bypass migration verification, tests, deployment verification, provider integrity, model governance, qualification, confidence, or wager-authority gates.
- New expected conditions require an explicit narrow reason code and must retain the underlying fail-closed behavior.
