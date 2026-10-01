import { useEffect, useMemo, useState } from "react";

function money(v){ return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "—"; }

export default function PrizePicksMarketPanel({ sportFilter = "all" }) {
  const [rows,setRows]=useState([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const sport=String(sportFilter||"all").toLowerCase();

  useEffect(()=>{
    let cancelled=false;
    setLoading(true); setError("");
    const q=new URLSearchParams({limit:"300"});
    if(sport!=="all") q.set("sport",sport);
    fetch(`/api/prizepicks-props?${q}`,{credentials:"same-origin"})
      .then(async res=>{const j=await res.json().catch(()=>({}));if(!res.ok||j?.ok===false)throw new Error(j?.error||`HTTP ${res.status}`);return j})
      .then(j=>{if(!cancelled)setRows(Array.isArray(j.rows)?j.rows:[])})
      .catch(e=>{if(!cancelled){setRows([]);setError(String(e?.message||e))}})
      .finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[sport]);

  const latest=useMemo(()=>{
    const seen=new Set(), out=[];
    for(const r of rows){
      const key=[r.sport,r.player_name,r.canonical_market,r.odds_tier].join("|");
      if(seen.has(key)) continue;
      seen.add(key); out.push(r);
    }
    return out.slice(0,100);
  },[rows]);

  return (
    <section className="panel" aria-label="PrizePicks curated market">
      <header className="panel-header">
        <div>
          <h2 className="panel-title">PrizePicks Curated Market</h2>
          <p className="muted">Only FBIS-approved market families are collected. PrizePicks observations are market inputs, not automatic qualified plays.</p>
        </div>
        <span className="canonical-chip">{loading ? "LOADING" : `${latest.length} CURRENT LINES`}</span>
      </header>
      {error ? <p className="error-text">{error}</p> : null}
      {!loading && !error && !latest.length ? <p className="muted">No curated PrizePicks observations have been persisted for this filter yet.</p> : null}
      {latest.length ? (
        <div className="table-scroll">
          <table className="fbis-table">
            <thead><tr><th>Sport</th><th>Player</th><th>Market</th><th>PP Line</th><th>FBIS</th><th>Diff</th><th>Read</th><th>Tier</th><th>Observed</th></tr></thead>
            <tbody>
              {latest.map((r,i)=>(
                <tr key={r.id||`${r.projection_id}-${i}`}>
                  <td>{String(r.sport||"").toUpperCase()}</td>
                  <td><b>{r.player_name||"—"}</b><div className="muted small">{r.team||""}</div></td>
                  <td>{String(r.canonical_market||r.stat_type||"—").replaceAll("_"," ")}</td>
                  <td>{r.line ?? "—"}</td>
                  <td>{r.fbis_projection == null ? "—" : money(r.fbis_projection)}</td>
                  <td>{r.delta_fbis_minus_line == null ? "—" : money(r.delta_fbis_minus_line)}</td>
                  <td>{r.candidate_side||"WATCH"}</td>
                  <td>{r.odds_tier||"STANDARD"}</td>
                  <td className="muted small">{r.collected_at ? new Date(r.collected_at).toLocaleString("en-US",{timeZone:"America/Chicago"}) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
