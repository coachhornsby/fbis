// tennisTotalGamesScan.js — find the OVER/UNDER signal on total games against REAL OddsPapi lines.
//
// Against real closing lines the unconditional over/under split is ~50% (books price it there), so
// a condition whose hit rate sits well above 50% is a genuine edge — no line-placement artifact.
// That's the whole reason to use real lines instead of a naive baseline.
//
// Inputs:
//   lineRecords : [{ date:'YYYY-MM-DD', playerA, playerB, line }]  (from oddspapiClient, names resolved)
//   sackmannRows: melted rows from tennisFeed (carry totalGames, surface, playerRank, oppRank)
// Output: ranked signals with n, hit%, lift over 50%, and an (informational) Wilson LB.

export function wilsonLo(w, n, z = 1.96) {
  if (!n) return 0;
  const p = w / n, d = 1 + z * z / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
}

const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// key a player to last-name + first-initial so "Carlos Alcaraz" ~ "C. Alcaraz" ~ "Alcaraz Carlos"
function nameKey(name) {
  const parts = stripAccents(name).toLowerCase().replace(/[.\-]/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const last = parts[parts.length - 1];
  const firstInit = (parts[0] || ' ')[0];
  return `${last}|${firstInit}`;
}
const pairKey = (a, b, date) => [nameKey(a), nameKey(b)].sort().join('~') + '@' + date;

// Build match-level outcome index from melted rows (each match appears twice; dedupe).
export function buildOutcomeIndex(sackmannRows) {
  const idx = new Map();
  for (const r of sackmannRows) {
    if (!r.totalGames || !r.playerName || !r.oppName) continue;
    const k = pairKey(r.playerName, r.oppName, r.date);
    if (idx.has(k)) continue;
    idx.set(k, { total: r.totalGames, surface: r.surface, date: r.date,
      rankGap: (r.playerRank != null && r.oppRank != null) ? Math.abs(r.playerRank - r.oppRank) : null });
  }
  return idx;
}

// Join lines to outcomes (exact pair+date, then ±1 day fallback).
export function joinLines(lineRecords, outcomeIndex) {
  const joined = [];
  for (const L of lineRecords) {
    if (L.line == null) continue;
    let m = outcomeIndex.get(pairKey(L.playerA, L.playerB, L.date));
    if (!m) { // ±1 day
      for (const d of [-1, 1]) {
        const dt = new Date(Date.parse(L.date + 'T00:00:00Z') + d * 86400e3).toISOString().slice(0, 10);
        m = outcomeIndex.get(pairKey(L.playerA, L.playerB, dt));
        if (m) break;
      }
    }
    if (m) joined.push({ line: L.line, total: m.total, surface: m.surface, rankGap: m.rankGap });
  }
  return joined;
}

function signals() {
  return [
    { name: 'UNDER — ANY (base rate, ~50% if lines efficient)', side: 'under', fires: () => true },
    { name: 'UNDER — rank gap ≥ 60', side: 'under', fires: (m) => m.rankGap != null && m.rankGap >= 60 },
    { name: 'UNDER — rank gap ≥ 120', side: 'under', fires: (m) => m.rankGap != null && m.rankGap >= 120 },
    { name: 'UNDER — clay', side: 'under', fires: (m) => m.surface === 'Clay' },
    { name: 'UNDER — clay + rank gap ≥ 60', side: 'under', fires: (m) => m.surface === 'Clay' && m.rankGap >= 60 },
    { name: 'OVER — grass', side: 'over', fires: (m) => m.surface === 'Grass' },
    { name: 'OVER — rank gap ≤ 10 (even match)', side: 'over', fires: (m) => m.rankGap != null && m.rankGap <= 10 },
  ];
}

export function scanTotalGames(lineRecords, sackmannRows) {
  const joined = joinLines(lineRecords, buildOutcomeIndex(sackmannRows));
  const hit = (m, side) => side === 'under' ? m.total < m.line : m.total > m.line;
  const sigs = signals().map((s) => {
    let n = 0, h = 0;
    for (const m of joined) { if (!s.fires(m)) continue; n++; if (hit(m, s.side)) h++; }
    return { name: s.name, side: s.side, n, hits: h, rate: n ? h / n : null, wilsonLo: wilsonLo(h, n) };
  });
  // base = the matching side's unconditional rate; lift over it = real edge
  const underBase = sigs.find((s) => s.name.startsWith('UNDER — ANY'))?.rate ?? 0.5;
  const overBase = 1 - underBase;
  return { matches: joined.length, signals: sigs.map((s) => {
    const base = s.side === 'under' ? underBase : overBase;
    const lift = s.rate == null ? null : s.rate - base;
    return { ...s, base, lift, edge: s.n >= 40 && s.wilsonLo > 0.524 && lift != null && lift > 0.04 };
  }).sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1)) };
}

export default { scanTotalGames, joinLines, buildOutcomeIndex, wilsonLo };
