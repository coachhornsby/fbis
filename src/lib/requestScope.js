/**
 * Active-scope tokens so a late sport response cannot paint another sport/date/page.
 */

export function nextRequestScope(ref, { sport, date, page, week = null } = {}) {
  const seq = Number(ref.current?.seq || 0) + 1;
  const scope = { seq, sport, date, page, week };
  ref.current = scope;
  return scope;
}

export function scopeMatches(active, issued, { responseSport = null, responseDate = null } = {}) {
  if (!active || !issued) return false;
  if (active.seq !== issued.seq) return false;
  if (active.page !== issued.page) return false;
  if (String(active.sport || "") !== String(issued.sport || "")) return false;
  if (String(active.date || "") !== String(issued.date || "")) return false;
  if (String(active.week || "") !== String(issued.week || "")) return false;
  if (responseSport && issued.sport && issued.sport !== "all" && String(responseSport) !== String(issued.sport)) {
    return false;
  }
  if (responseDate && issued.date && String(responseDate) !== String(issued.date)) return false;
  return true;
}

export function applyIfCurrent(ref, issued, updater, payloadMeta = {}) {
  if (!scopeMatches(ref.current, issued, payloadMeta)) return false;
  updater();
  return true;
}
