// tennisColdStart.mjs — fail-closed cold-start profiles from observed live matches only.
//
// Historical profile -> use it.
// Otherwise, build a temporary profile only when the live adapter provides enough observed
// serve/return history. Generic tour/rank baselines are NOT permitted to masquerade as player data.
// If the live sample is inadequate, return player:null so analyze.mjs emits
// NO VALID PROJECTION / INSUFFICIENT PLAYER DATA.

export const MIN_COLD_START_MATCHES = 5;

const finite = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const mean = (xs) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const weighted = (rows, valueKey, weightKey) => {
  let n=0,d=0;
  for (const r of rows) {
    const v=finite(r[valueKey]), w=finite(r[weightKey]);
    if (v==null || w==null || w<=0) continue;
    n += v*w; d += w;
  }
  return d ? n/d : null;
};

function observedProfile(name, rows, surface, liveSource) {
  const usable=(rows||[]).filter(r =>
    r && r.date && finite(r.svGms)>0 &&
    finite(r.servePtsWonPct)!=null &&
    finite(r.returnPtsWonPct)!=null &&
    finite(r.aces)!=null &&
    finite(r.doubleFaults)!=null
  );
  if (usable.length < MIN_COLD_START_MATCHES) return null;

  const surfaceRows=usable.filter(r => String(r.surface||'').toLowerCase()===String(surface||'Hard').toLowerCase());
  const mk=(sample) => {
    if (!sample.length) return null;
    const svGms=sample.reduce((s,r)=>s+(finite(r.svGms)||0),0);
    const ace=sample.reduce((s,r)=>s+(finite(r.aces)||0),0);
    const df=sample.reduce((s,r)=>s+(finite(r.doubleFaults)||0),0);
    const spw=weighted(sample,'servePtsWonPct','svGms');
    const rpw=weighted(sample,'returnPtsWonPct','svGms');
    if (!svGms || spw==null || rpw==null) return null;
    return {
      n: sample.length, svGms, retGms: svGms,
      acePerSvGm: ace/svGms,
      dfPerSvGm: df/svGms,
      servePtsWonPct: spw,
      retPtsWonPct: rpw,
      winPct: null,
      raw: { n: sample.length, svGms, retGms: svGms, acePerSvGm: ace/svGms,
        dfPerSvGm: df/svGms, servePtsWonPct: spw, retPtsWonPct: rpw }
    };
  };

  const all=mk(usable);
  if (!all) return null;
  const surfaces={ALL:all};
  const ss=mk(surfaceRows);
  if (ss) surfaces[surface]=ss;
  const last=usable.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))).at(-1);
  return {
    name,
    rank:null,
    surfaces,
    recent:{ lastDate:last?.date||null, lastSurface:last?.surface||null, _source:'live-cold-start' },
    _coldStart:true,
    _sampleMatches:usable.length,
    _profileSource:'live-observed',
    _liveSource:liveSource||null
  };
}

export async function resolveWithColdStart(liveSource, known, rawName, ctx={}) {
  if (known && known.surfaces && (known.surfaces.ALL?.n || 0) > 0) {
    return { player: known, coldStart:false, insufficient:false };
  }
  if (!liveSource || typeof liveSource.fetchRecentMatches !== 'function') {
    return { player:null, coldStart:false, insufficient:true, reason:'live_source_unavailable' };
  }
  const name=(known&&known.name)||rawName||'';
  try {
    const rows=await liveSource.fetchRecentMatches(name);
    const player=observedProfile(name,rows,ctx.surface||'Hard',ctx.liveSource||null);
    if (!player) return { player:null,coldStart:false,insufficient:true,
      reason:'insufficient_observed_live_history', sampleMatches:Array.isArray(rows)?rows.length:0 };
    return { player,coldStart:true,insufficient:false,liveSource:ctx.liveSource||null };
  } catch (e) {
    return { player:null,coldStart:false,insufficient:true,reason:'live_profile_error' };
  }
}

export default { resolveWithColdStart, MIN_COLD_START_MATCHES };
