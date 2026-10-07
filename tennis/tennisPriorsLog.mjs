// tennisPriorsLog.mjs — the validation ledger behind the honesty banner.
//
// The card's banner reads LIVE from these counts (spec C/D §3): it stays "PRIORS ONLY · logging
// (n/50)" until a bucket SHIPS — n>=50 AND observed hit rate beats break-even AND the Wilson lower
// bound clears break-even. Only then does the card upgrade to "TRACKED EDGE". The label literally
// cannot claim confidence the data hasn't earned. This is the same log that grades total-games /
// fantasy over time; here we expose per-bucket status for the win-prob card.
//
// Storage matches tennisLineLog.mjs: JSONL locally, or Supabase for serverless. A "bucket" is
// (tour, surface, tier, favorite?) — e.g. "ATP clay favorites".

import { readFileSync, existsSync } from 'node:fs';

const SHIP_MIN_N = 50;
const BREAKEVEN = 0.524;   // -110-ish; tighten per PrizePicks payout structure

export function wilsonLo(w, n, z = 1.96) {
  if (!n) return 0;
  const p = w / n, d = 1 + z * z / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
}

const bucketKey = ({ tour, surface }) =>
  `${(tour || 'tennis').toString().toLowerCase()}|${(surface || 'hard').toString().toLowerCase()}`;
const bucketLabel = ({ tour, surface }) =>
  `${tour || 'Tennis'} ${String(surface || '').toLowerCase()} favorites`.replace(/\s+/g, ' ').trim();

// Pluggable store. Default file store; swap for Supabase in serverless.
export function makeFileStore(path = './data/tennis/priors_log.jsonl') {
  return {
    async graded() {
      if (!existsSync(path)) return [];
      return readFileSync(path, 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((r) => r && r.hit != null);   // only settled rows
    },
  };
}
export function makeSupabaseStore({ url, key, table = 'tennis_priors_log' }) {
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    async graded() {
      const r = await fetch(`${url}/rest/v1/${table}?select=*&hit=not.is.null`, { headers: h });
      if (!r.ok) return [];
      return r.json();
    },
  };
}

/**
 * Status for one bucket. Returns { n, shipped, bucketLabel, hitRate, wilsonLo }.
 * Reads the store if one is configured (env TENNIS_LOG=file|supabase); else returns 0/priors.
 */
export async function bucketStatus(bucket, store = defaultStore()) {
  const label = bucketLabel(bucket);
  if (!store) return { n: 0, shipped: false, bucketLabel: label, hitRate: 0, wilsonLo: 0 };
  let rows = [];
  try { rows = await store.graded(); } catch { rows = []; }
  const key = bucketKey(bucket);
  const mine = rows.filter((r) => bucketKey(r) === key);
  const n = mine.length, w = mine.filter((r) => r.hit).length;
  const hitRate = n ? w / n : 0;
  const lo = wilsonLo(w, n);
  const shipped = n >= SHIP_MIN_N && hitRate > BREAKEVEN && lo > BREAKEVEN;
  return { n, shipped, bucketLabel: label, hitRate, wilsonLo: lo };
}

function defaultStore() {
  const mode = process.env.TENNIS_LOG;
  if (mode === 'supabase' && process.env.SUPABASE_URL && process.env.SUPABASE_KEY)
    return makeSupabaseStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY });
  if (mode === 'file') return makeFileStore();
  return null;   // no log configured → banner stays PRIORS ONLY, which is the safe default
}

export default { bucketStatus, wilsonLo, makeFileStore, makeSupabaseStore };
