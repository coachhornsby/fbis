// api/tennis/log.mjs — persist a graded line snapshot so every match you grade becomes a data point.
//
// POST { matchId, playerA, playerB, surface, tour, startTime, props:[{market,line,prob,mean,lean}] }
//   → appends one row per market to the priors log (bet:false; grading happens later vs real results)
// GET  ?a=&b=  → returns whether this matchup is already logged today (avoid dupes on re-Apply)
//
// Storage: Supabase when SUPABASE_URL/KEY + TENNIS_LOG=supabase; else in-memory (ephemeral, dev).
// Serverless disk is ephemeral, so file mode won't persist on Vercel — Supabase is the real store.

const MEM = globalThis.__tennisLog || (globalThis.__tennisLog = []);

function supa() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
  if (!url || !key || process.env.TENNIS_LOG !== 'supabase') return null;
  return { url, key, h: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

async function append(rows) {
  const s = supa();
  if (!s) { MEM.push(...rows); return { stored: 'memory', n: rows.length }; }
  const r = await fetch(`${s.url}/rest/v1/tennis_priors_log`, {
    method: 'POST', headers: { ...s.h, Prefer: 'return=minimal' }, body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return { stored: 'supabase', n: rows.length };
}

const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { a, b } = req.query || {};
      const today = new Date().toISOString().slice(0, 10);
      const s = supa();
      let logged = false;
      if (!s) {
        logged = MEM.some((r) => r.match_date === today && norm(r.player_a) === norm(a) && norm(r.player_b) === norm(b));
      } else {
        const q = `${s.url}/rest/v1/tennis_priors_log?select=id&match_date=eq.${today}&player_a=ilike.${encodeURIComponent(a || '')}`;
        const r = await fetch(q, { headers: s.h }); logged = r.ok && (await r.json()).length > 0;
      }
      res.status(200).json({ ok: true, logged, store: s ? 'supabase' : 'memory' });
      return;
    }

    if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST or GET' }); return; }

    // Vercel usually parses JSON; fall back to manual read if not.
    let body = req.body;
    if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
    const { matchId, playerA, playerB, surface, tour, startTime, props } = body;
    if (!playerA || !playerB || !Array.isArray(props) || !props.length) {
      res.status(400).json({ ok: false, error: 'need playerA, playerB, and props[]' }); return;
    }
    const now = new Date().toISOString();
    const matchDate = (startTime || now).slice(0, 10);
    const rows = props
      .filter((p) => p && p.line != null && p.prob != null)   // only real lines
      .map((p) => ({
        logged_at: now, match_date: matchDate, match_id: String(matchId || ''),
        tour: (tour || null), surface: (surface || null),
        player_a: playerA, player_b: playerB,
        market: p.market, side: p.lean || null,
        line: Number(p.line), model_prob: Math.round(Number(p.prob) * 1e4) / 1e4,
        model_proj: p.mean == null ? null : Math.round(Number(p.mean) * 100) / 100,
        result: null, hit: null, winner: null, graded_at: null,   // cron fills these later
      }));
    if (!rows.length) { res.status(400).json({ ok: false, error: 'no gradeable lines in props' }); return; }
    const out = await append(rows);
    res.status(200).json({ ok: true, ...out, bet: false });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });   // fail soft — never block the UI
  }
}
