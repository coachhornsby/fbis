/**
 * Canonical production migration tip declaration.
 *
 * Health and CI treat this as the required schema tip identity.
 * scripts/verify-migrations.mjs fails if this drifts from the latest
 * sorted migrations/*.sql filename.
 *
 * Do not discover the tip from the Workers filesystem at runtime.
 * Advance this declaration whenever a new migration file is added.
 */

/** Latest migration filename (Wrangler d1_migrations.name form). */
export const EXPECTED_MIGRATION_FILE = "0098_college_persistence_recovery.sql";

/** Latest migration id (schema_migrations.id form; no .sql suffix). */
export const EXPECTED_MIGRATION_ID = "0098_college_persistence_recovery";

/** @deprecated Prefer EXPECTED_MIGRATION_ID — kept for response field naming. */
export const EXPECTED_MIGRATION = EXPECTED_MIGRATION_ID;

export const MIGRATION_STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  UNVERIFIED: "UNVERIFIED",
});

/**
 * Evaluate schema tip presence against schema_migrations.
 *
 * Authority: schema_migrations.id is the application ledger written by
 * migration SQL. d1_migrations (Wrangler filename bookkeeping) is reported
 * when available but is NOT required for VERIFIED — dual-ledger hard-fail
 * remains deferred until production authority is proven (see repair report).
 *
 * @param {{ tipRow?: { id?: string } | null, observedMaxId?: string | null, wranglerTipName?: string | null, wranglerLedgerAvailable?: boolean | null, readOk?: boolean, errorMessage?: string | null }} input
 */
export function evaluateSchemaMigrationHealth(input = {}) {
  const {
    tipRow = null,
    observedMaxId = null,
    wranglerTipName = null,
    wranglerLedgerAvailable = null,
    readOk = true,
    errorMessage = null,
  } = input;

  if (!readOk) {
    return {
      version: null,
      status: MIGRATION_STATUS.UNVERIFIED,
      expectedMigration: EXPECTED_MIGRATION_ID,
      expectedMigrationFile: EXPECTED_MIGRATION_FILE,
      wranglerVersion: null,
      wranglerTipPresent: null,
      wranglerLedgerAvailable: null,
      tipPresent: false,
    };
  }

  if (errorMessage) {
    const msg = String(errorMessage);
    if (/not authorized|authentication|permission/i.test(msg)) {
      return {
        version: null,
        status: MIGRATION_STATUS.BLOCKED,
        expectedMigration: EXPECTED_MIGRATION_ID,
        expectedMigrationFile: EXPECTED_MIGRATION_FILE,
        wranglerVersion: null,
        wranglerTipPresent: null,
        wranglerLedgerAvailable: null,
        tipPresent: false,
      };
    }
    if (/no such table|no such column|syntax/i.test(msg)) {
      return {
        version: null,
        status: MIGRATION_STATUS.FAILED,
        expectedMigration: EXPECTED_MIGRATION_ID,
        expectedMigrationFile: EXPECTED_MIGRATION_FILE,
        wranglerVersion: null,
        wranglerTipPresent: null,
        wranglerLedgerAvailable: null,
        tipPresent: false,
      };
    }
    return {
      version: null,
      status: MIGRATION_STATUS.UNVERIFIED,
      expectedMigration: EXPECTED_MIGRATION_ID,
      expectedMigrationFile: EXPECTED_MIGRATION_FILE,
      wranglerVersion: null,
      wranglerTipPresent: null,
      wranglerLedgerAvailable: null,
      tipPresent: false,
    };
  }

  const tipPresent = String(tipRow?.id || "") === EXPECTED_MIGRATION_ID;
  const wranglerTipPresent =
    wranglerLedgerAvailable === true
      ? String(wranglerTipName || "") === EXPECTED_MIGRATION_FILE
      : null;

  return {
    // Prefer the verified tip id; otherwise surface observed max for operators
    // without claiming verification (null when nothing observed).
    version: tipPresent ? EXPECTED_MIGRATION_ID : observedMaxId || null,
    status: tipPresent ? MIGRATION_STATUS.VERIFIED : MIGRATION_STATUS.UNVERIFIED,
    expectedMigration: EXPECTED_MIGRATION_ID,
    expectedMigrationFile: EXPECTED_MIGRATION_FILE,
    wranglerVersion: wranglerLedgerAvailable === true ? wranglerTipName || null : null,
    wranglerTipPresent,
    wranglerLedgerAvailable,
    tipPresent,
  };
}
