/** Shared display helpers for Today command-center surfaces. Never invent values. */

export function matchupLabel(event) {
  const away = event?.teams?.away?.abbr || event?.teams?.away?.name || "—";
  const home = event?.teams?.home?.abbr || event?.teams?.home?.name || "—";
  return `${away} @ ${home}`;
}

export function fmtLine(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return n > 0 ? `+${n}` : String(n);
}

export function fmtPrice(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return n > 0 ? `+${n}` : String(n);
}

export function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Math.round(Number(v))}%`;
}

export function fmtNum(v, digits = 1) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(digits);
}

export function decisionClass(state) {
  const s = String(state || "RESEARCH").toLowerCase();
  return `decision-chip decision-${s}`;
}
