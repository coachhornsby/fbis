// tennisFeed.js — Sackmann atp_matches_*/wta_matches_* → normalized, MELTED player-match rows.
//
// Why melt: Sackmann stores stats winner/loser-prefixed (w_ace / l_ace). If you aggregate
// off w_* you only ever see matches a player WON → survivorship bias, inflated serve rates.
// We explode every match into two player-perspective rows so each player's profile includes
// losses, and we attach the OPPONENT's serve line so return stats + aces-faced are recoverable.
//
// No external deps. ESM. Run standalone or import buildRowsFromCsv / meltMatch.

const NUM = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Parse one Sackmann CSV line respecting simple quoting (player names rarely contain commas,
// but tourney names can). Minimal CSV: handles double-quoted fields with embedded commas.
function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// score → { wGames, lGames, total, retired, walkover, sets }.
// Sackmann writes each set winner-games first: "6-4 3-6 7-6(5)". RET / W/O / DEF flagged.
export function parseScore(score) {
  const s = String(score || '').trim();
  const res = { wGames: 0, lGames: 0, total: 0, retired: false, walkover: false, sets: 0, valid: false };
  if (!s) return res;
  if (/W\/?O/i.test(s)) { res.walkover = true; return res; }
  if (/RET|DEF/i.test(res.retiredFlag = s)) res.retired = true;
  const tokens = s.replace(/\(([^)]*)\)/g, '').split(/\s+/); // strip tiebreak parens
  for (const t of tokens) {
    if (/^(RET|DEF|W\/?O)$/i.test(t)) continue;
    const m = t.match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    res.wGames += a; res.lGames += b; res.sets++;
  }
  res.total = res.wGames + res.lGames;
  res.valid = res.sets > 0;
  return res;
}

// tourney_date is YYYYMMDD (int). Return ISO-ish YYYY-MM-DD string for readability.
function fmtDate(d) {
  const s = String(d || '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

// Build a per-side serve line object from a winner/loser prefix ('w' | 'l').
function serveLine(rec, idx, p) {
  return {
    ace: NUM(rec[idx[`${p}_ace`]]),
    df: NUM(rec[idx[`${p}_df`]]),
    svpt: NUM(rec[idx[`${p}_svpt`]]),
    firstIn: NUM(rec[idx[`${p}_1stIn`]]),
    firstWon: NUM(rec[idx[`${p}_1stWon`]]),
    secondWon: NUM(rec[idx[`${p}_2ndWon`]]),
    svGms: NUM(rec[idx[`${p}_SvGms`]]),
    bpSaved: NUM(rec[idx[`${p}_bpSaved`]]),
    bpFaced: NUM(rec[idx[`${p}_bpFaced`]]),
  };
}

// One match record (array) + header index → two melted player-match rows.
export function meltMatch(rec, idx) {
  const surface = rec[idx.surface] || 'Unknown';
  const level = rec[idx.tourney_level] || '';
  const bestOf = NUM(rec[idx.best_of]) || 3;
  const round = rec[idx.round] || '';
  const minutes = NUM(rec[idx.minutes]);
  const date = fmtDate(rec[idx.tourney_date]);
  const tourney = rec[idx.tourney_name] || '';
  const sc = parseScore(rec[idx.score]);

  const W = serveLine(rec, idx, 'w');
  const L = serveLine(rec, idx, 'l');
  const wName = rec[idx.winner_name] || '', lName = rec[idx.loser_name] || '';
  const wId = rec[idx.winner_id] || wName, lId = rec[idx.loser_id] || lName;
  const wRank = NUM(rec[idx.winner_rank]), lRank = NUM(rec[idx.loser_rank]);

  // hasStats: rows before 1991 (or missing) have no serve counters — usable for W/L + form,
  // NOT for serve-rate aggregation. Flag so the builder can exclude them from rate sums.
  const hasStats = W.svpt != null && L.svpt != null && W.svGms != null;

  const base = { date, tourney, surface, level, bestOf, round, minutes,
    totalGames: sc.total, retired: sc.retired, walkover: sc.walkover, hasStats };

  const row = (self, opp, selfId, selfName, oppId, oppName, won, selfRank, oppRank, selfGames) => ({
    ...base, won,
    playerId: selfId, playerName: selfName, oppId, oppName,
    playerRank: selfRank, oppRank,
    gamesWon: selfGames,
    // self serve
    ace: self.ace, df: self.df, svpt: self.svpt, firstIn: self.firstIn,
    firstWon: self.firstWon, secondWon: self.secondWon, svGms: self.svGms,
    bpSaved: self.bpSaved, bpFaced: self.bpFaced,
    // opponent serve → lets us derive THIS player's return + aces-faced
    oppAce: opp.ace, oppSvpt: opp.svpt, oppFirstWon: opp.firstWon,
    oppSecondWon: opp.secondWon, oppSvGms: opp.svGms,
    oppBpFaced: opp.bpFaced, oppBpSaved: opp.bpSaved,
  });

  return [
    row(W, L, wId, wName, lId, lName, 1, wRank, lRank, sc.wGames),
    row(L, W, lId, lName, wId, wName, 0, lRank, wRank, sc.lGames),
  ];
}

// Full CSV text → melted rows. Tolerates the exact Sackmann header set.
export function buildRowsFromCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]);
  const idx = {};
  header.forEach((h, i) => { idx[h.trim()] = i; });
  if (idx.winner_name == null || idx.score == null) {
    throw new Error('Unrecognized header — expected Sackmann atp_matches/wta_matches columns');
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const rec = splitCsvLine(lines[i]);
    if (rec.length < header.length - 2) continue; // skip truncated
    try { rows.push(...meltMatch(rec, idx)); } catch { /* skip malformed */ }
  }
  return rows;
}

export default { buildRowsFromCsv, meltMatch, parseScore };
