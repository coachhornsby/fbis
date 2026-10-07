// tennisLineLog.mjs — the forward line log. THIS is what turns PRIOR reads into graded tiers.
//
// Why it exists: every prop is bet:false because we have never compared our probability to a REAL
// line and then to the REAL result. History alone can't do it — Sackmann has outcomes but no
// historical PrizePicks lines. So we log going forward: snapshot each slate's standard lines + our
// projection, then grade after results land, and compute hit rate + Wilson lower bound per market.
// Only a market whose Wilson LB clears breakeven on a real cohort earns a graded tier.
//
// Storage is pluggable. Default = JSONL on disk (works locally / on a cron box). For Vercel
// (ephemeral disk) pass a Supabase-backed store — see makeSupabaseStore below.
//
// CLI:
//   node tennis/tennisLineLog.mjs snapshot   # log today's lines + our reads
//   node tennis/tennisLineLog.mjs grade      # fill in results, print hit rates + Wilson LB

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function wilsonLo(w, n, z = 1.96) {
  if (!n) return 0;
  const p = w / n, d = 1 + z * z / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
}

// ---- stores -------------------------------------------------------------------------------
export function makeFileStore(path = './data/tennis/line_log.jsonl') {
  return {
    async append(rows) {
      if (!rows.length) return 0;
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      return rows.length;
    },
    async all() {
      if (!existsSync(path)) return [];
      return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    },
  };
}

// Supabase store — for serverless, where disk is ephemeral. Table:
//   create table tennis_line_log (
//     id bigserial primary key, logged_at timestamptz, start_time timestamptz,
//     match_id text, player_a text, player_b text, surface text,
//     market text, side text, line numeric, model_prob numeric, model_proj numeric,
//     result numeric, hit boolean
//   );
export function makeSupabaseStore({ url, key, table = 'tennis_line_log' }) {
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return {
    async append(rows) {
      if (!rows.length) return 0;
      const r = await fetch(`${url}/rest/v1/${table}`, { method: 'POST', headers: h, body: JSON.stringify(rows) });
      if (!r.ok) throw new Error(`supabase append ${r.status}: ${(await r.text()).slice(0, 120)}`);
      return rows.length;
    },
    async all() {
      const r = await fetch(`${url}/rest/v1/${table}?select=*`, { headers: h });
      if (!r.ok) throw new Error(`supabase read ${r.status}`);
      return r.json();
    },
  };
}

// ---- snapshot -----------------------------------------------------------------------------
/**
 * Log one slate: for each match we can read, record every standard PrizePicks line alongside our
 * model's probability and projection. `reads` is [{matchId, playerA, playerB, surface, startTime,
 * props:{market:{line, prob, mean, lean}}}].
 */
export async function snapshot(store, reads, loggedAt = new Date().toISOString()) {
  const rows = [];
  for (const r of reads) {
    for (const [market, p] of Object.entries(r.props || {})) {
      if (!p || p.line == null || p.prob == null) continue;   // only log rows with a REAL line
      rows.push({
        logged_at: loggedAt, start_time: r.startTime || null,
        match_id: String(r.matchId || ''), player_a: r.playerA, player_b: r.playerB,
        surface: r.surface || null,
        market, side: p.lean || null, line: p.line,
        model_prob: Math.round(p.prob * 1e4) / 1e4,
        model_proj: p.mean == null ? null : Math.round(p.mean * 100) / 100,
        result: null, hit: null,
      });
    }
  }
  await store.append(rows);
  return rows.length;
}

// ---- grade --------------------------------------------------------------------------------
/**
 * Grade logged rows against actual results. `resultsFor(row)` returns the realized number for that
 * market (e.g. actual total games), or null if the match isn't final yet.
 * Returns per-market hit rate, Wilson LB, and whether it clears the bar.
 */
export async function grade(store, resultsFor, { breakeven = 0.524, minN = 30 } = {}) {
  const rows = await store.all();
  const byMarket = new Map();
  for (const row of rows) {
    const actual = row.result != null ? row.result : await resultsFor(row);
    if (actual == null) continue;
    const hit = row.side === 'UNDER' ? actual < row.line : actual > row.line;
    const m = byMarket.get(row.market) || { n: 0, w: 0 };
    m.n++; if (hit) m.w++;
    byMarket.set(row.market, m);
  }
  const out = [];
  for (const [market, m] of byMarket) {
    const lo = wilsonLo(m.w, m.n);
    out.push({ market, n: m.n, hits: m.w, rate: m.n ? m.w / m.n : null, wilsonLo: lo,
      graded: m.n >= minN && lo > breakeven });
  }
  return out.sort((a, b) => b.wilsonLo - a.wilsonLo);
}

export default { snapshot, grade, wilsonLo, makeFileStore, makeSupabaseStore };
