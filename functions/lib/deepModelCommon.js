/** Shared helpers for research-only deep sport challengers. */

export function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v)));
}

export function round1(v) {
  return Math.round(Number(v) * 10) / 10;
}

export function meanPresent(values = []) {
  const xs = values.map(finite).filter((v) => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function weightedPresent(parts = []) {
  let num = 0;
  let den = 0;
  for (const part of parts) {
    const value = finite(part?.value);
    const weight = finite(part?.weight);
    if (value == null || weight == null || weight <= 0) continue;
    num += value * weight;
    den += weight;
  }
  return den ? num / den : null;
}

export function normalizedAdvantage(offense, defense, scale = 1) {
  const o = finite(offense);
  const d = finite(defense);
  if (o == null || d == null) return null;
  return clamp((o - d) * scale, -1, 1);
}

export function coverageSummary(groups = {}) {
  const entries = Object.entries(groups);
  const available = entries.filter(([, v]) => v != null && v !== false).map(([k]) => k);
  const missing = entries.filter(([, v]) => v == null || v === false).map(([k]) => k);
  return {
    available,
    missing,
    nAvailable: available.length,
    nTotal: entries.length,
    share: entries.length ? available.length / entries.length : 0,
  };
}

export function decomposition({ baseHome, baseAway, homeLayers = {}, awayLayers = {}, shrink = 1 } = {}) {
  const bh = finite(baseHome);
  const ba = finite(baseAway);
  if (bh == null || ba == null) return null;
  const homeDelta = Object.values(homeLayers).map(finite).filter((v) => v != null).reduce((a, b) => a + b, 0) * shrink;
  const awayDelta = Object.values(awayLayers).map(finite).filter((v) => v != null).reduce((a, b) => a + b, 0) * shrink;
  const home = round1(Math.max(0, bh + homeDelta));
  const away = round1(Math.max(0, ba + awayDelta));
  return {
    baseHome: bh,
    baseAway: ba,
    homeLayers,
    awayLayers,
    homeDelta: round1(homeDelta),
    awayDelta: round1(awayDelta),
    home,
    away,
    margin: round1(home - away),
    total: round1(home + away),
    shrink,
  };
}
