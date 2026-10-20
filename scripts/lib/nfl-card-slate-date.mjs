/**
 * Select the earliest NFL slate actually reported by the already-authorized
 * fixture discovery step. No provider requests or model decisions occur here.
 */
export function nextNflSlateDate(receipts) {
  if (!Array.isArray(receipts)) throw new TypeError('NFL_FIXTURE_RECEIPTS_REQUIRED');
  const dates = [];
  for (const receipt of receipts) {
    if (receipt?.sport !== 'nfl') continue;
    const count = Number(receipt.fixtures);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('INVALID_NFL_FIXTURE_COUNT');
    if (count === 0) continue;
    const date = String(receipt.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z')))
      throw new Error('INVALID_NFL_SLATE_DATE');
    dates.push(date);
  }
  return dates.sort()[0] || null;
}

/** A real NFL slate must have game cards with spread AND total evidence. */
export function nflCardReadiness({ slateDate, http, games }) {
  if (!slateDate) return { ok: true, state: 'NO_NFL_SLATE_IN_WINDOW' };
  if (http !== 200 || !Array.isArray(games) || games.length === 0)
    return { ok: false, state: 'NFL_SLATE_MISSING' };
  const missing = games.filter(g => {
    const paired = g?.pinnoddsResearch?.pairedMarkets;
    return !Array.isArray(paired) || !paired.includes('spread') || !paired.includes('total');
  }).length;
  return { ok: missing === 0, state: missing ? 'NFL_MARKETS_INCOMPLETE' : 'READY', missing };
}
