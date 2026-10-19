/**
 * NBA forward-slate date window.
 *
 * Team schedule items store the full season; the board `games` table and
 * prospective shadow historically only covered Chicago "today" (+ tomorrow for
 * collect). Opening week and multi-day NBA boards need a bounded look-ahead so
 * projections and freeze rows exist before tipoff day.
 *
 * Governance: look-ahead only widens ingestion/publication windows. It does not
 * change model coefficients, qualification, or wager authorization.
 */

export const NBA_FORWARD_COLLECT_DAYS = 4; // today .. +4 (five CT dates)
export const NBA_FORWARD_SHADOW_DAYS = 6; // today .. +6 for prospective shadow

export function shiftIsoDate(isoDate, deltaDays) {
  const [y, m, d] = String(isoDate || "")
    .slice(0, 10)
    .split("-")
    .map(Number);
  if (![y, m, d].every((n) => Number.isFinite(n))) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
  return dt.toISOString().slice(0, 10);
}

export function nbaForwardDates(today, throughDays = NBA_FORWARD_SHADOW_DAYS) {
  const start = String(today || "").slice(0, 10);
  const n = Math.max(0, Math.min(14, Number(throughDays)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(n)) return [];
  const out = [];
  for (let i = 0; i <= n; i += 1) {
    const day = shiftIsoDate(start, i);
    if (day) out.push(day);
  }
  return out;
}

export function parseNbaDateArgs(args = {}) {
  if (args.dates) {
    return String(args.dates)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  }
  if (args.date) {
    const start = String(args.date).slice(0, 10);
    const throughDays =
      args.throughDays != null && args.throughDays !== ""
        ? Number(args.throughDays)
        : 0;
    if (throughDays > 0) return nbaForwardDates(start, throughDays);
    return /^\d{4}-\d{2}-\d{2}$/.test(start) ? [start] : [];
  }
  return [];
}

/** Collect freeze window: today + tomorrow + bounded NBA look-ahead. */
export function nbaCollectDates(today, { dayOffset = null, shiftDateCT } = {}) {
  const shift =
    typeof shiftDateCT === "function"
      ? shiftDateCT
      : (d, n) => shiftIsoDate(d, n);
  if (dayOffset != null && dayOffset !== "" && Number.isFinite(Number(dayOffset))) {
    return [shift(today, Number(dayOffset))];
  }
  const days = [today, shift(today, 1)];
  for (let i = 2; i <= NBA_FORWARD_COLLECT_DAYS; i += 1) {
    days.push(shift(today, i));
  }
  return [...new Set(days.filter(Boolean))];
}
