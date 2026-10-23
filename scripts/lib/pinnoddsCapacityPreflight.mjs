/** Fail closed before PinnOdds provider quota is reserved or spent.
 * PinnOdds research observations route to the Q4 market-history partition.
 * This is a read-only preflight, not proof that subsequent D1 writes will succeed.
 */
export const PINNODDS_Q4_WRITE_CUTOFF = 0.85;

export function requirePinnoddsMarketHistoryHeadroom(report) {
  const q4 = report?.marketHistoryQ4;
  if (
    report?.ok !== true ||
    !Number.isSafeInteger(q4?.usedBytes) ||
    !Number.isSafeInteger(q4?.hardLimitBytes) ||
    q4.hardLimitBytes <= 0 ||
    q4.usedBytes < 0
  ) throw Error('PINNODDS_CAPACITY_PREFLIGHT_UNVERIFIED_FAIL_CLOSED');
  const ratio = q4.usedBytes / q4.hardLimitBytes;
  if (ratio >= PINNODDS_Q4_WRITE_CUTOFF)
    throw Error('PINNODDS_Q4_CAPACITY_PREFLIGHT_BLOCKED_NO_PROVIDER_CALL');
  return {databaseKey:'MARKET_HISTORY_2026Q4',usedBytes:q4.usedBytes,hardLimitBytes:q4.hardLimitBytes,percentUsed:ratio*100};
}
