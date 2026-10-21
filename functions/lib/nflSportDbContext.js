import { SPORT_DATABASES } from "./databaseTopology.js";

/**
 * Preserve independently approved sport DB bindings and CORE receipts through
 * request-local slate/harvest environments. No mode/receipt is synthesized.
 * All actual sport authority remains gated by productSportDbHandle().
 */
export function sportDbContext(env = {}) {
  const context = {
    CORE_DB: env.CORE_DB,
    __fbisCutoverApprovals: env.__fbisCutoverApprovals,
  };
  for (const [sport, plan] of Object.entries(SPORT_DATABASES)) {
    const upper = sport.toUpperCase();
    context[plan.binding] = env[plan.binding];
    context[`SPORT_DB_MODE_${upper}`] = env[`SPORT_DB_MODE_${upper}`];
    context[`SPORT_DB_STRICT_${upper}`] = env[`SPORT_DB_STRICT_${upper}`];
    context[`SPORT_CUTOVER_RECEIPT_${upper}`] = env[`SPORT_CUTOVER_RECEIPT_${upper}`];
    context[`SPORT_DB_LEDGER_READY_${upper}`] = env[`SPORT_DB_LEDGER_READY_${upper}`];
  }
  context.NHL_SPORT_DB_MODE = env.NHL_SPORT_DB_MODE;
  return context;
}

/** Backward-compatible entrypoint already used across Pages API routes. */
export function nflSportDbContext(env = {}) {
  return sportDbContext(env);
}
