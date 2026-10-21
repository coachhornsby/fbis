/**
 * Preserve approval-controlled NFL sport bindings through the legacy
 * request-specific slate/harvest environment builders.
 * Does not grant authority: productSportDbHandle independently checks
 * deployed mode, binding identity, receipt, and hydrated CORE approval.
 */
export function nflSportDbContext(env = {}) {
  return {
    NFL_DB: env.NFL_DB,
    CORE_DB: env.CORE_DB,
    SPORT_DB_MODE_NFL: env.SPORT_DB_MODE_NFL,
    SPORT_DB_STRICT_NFL: env.SPORT_DB_STRICT_NFL,
    SPORT_CUTOVER_RECEIPT_NFL: env.SPORT_CUTOVER_RECEIPT_NFL,
    __fbisCutoverApprovals: env.__fbisCutoverApprovals,
  };
}
