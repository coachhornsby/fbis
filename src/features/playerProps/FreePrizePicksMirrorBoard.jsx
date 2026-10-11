import {useEffect,useMemo,useState} from "react";
import {
  FREE_NFL_MIRROR_URL,FREE_NFL_MIRROR_SOURCE_URL,
  normalizeFreeNflMirror,mirrorChicagoDay,
} from "./freePrizePicksMirror.js";

/**
 * Standalone, third-party research surface. Never enters the wager/prop
 * model pipeline, and never claims a live executable PrizePicks quote.
 */
export default function FreePrizePicksMirrorBoard(){
  const [result,setResult]=useState(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [refresh,setRefresh]=useState(0);
  const [coreOnly,setCoreOnly]=useState(true);
  const [search,setSearch]=useState("");
  const [limit,setLimit]=useState(48);

  useEffect(()=>{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    setLoading(true);setError("");
    const url=FREE_NFL_MIRROR_URL+"?fbis_day="+encodeURIComponent(mirrorChicagoDay(new Date())||"");
    fetch(url,{signal:controller.signal,cache:"no-store"})
      .then(async res=>{
        if(!res.ok)throw new Error("Mirror HTTP "+res.status);
        return res.json();
      })
      .then(data=>{
        if(controller.signal.aborted)return;
        const normalized=normalizeFreeNflMirror(data,{now:new Date()});
        setResult(normalized);
        if(!normalized.ok)setError(normalized.error);
      })
      .catch(err=>{
        if(controller.signal.aborted)return;
        setResult(null);
        setError("Free mirror unavailable: "+String(err?.message||err));
      })
      .finally(()=>{clearTimeout(timeout);if(!controller.signal.aborted)setLoading(false);});
    return()=>{controller.abort();clearTimeout(timeout);};
  },[refresh]);

  const rows=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return (result?.rows||[]).filter(row=>
      (!coreOnly||row.market!=null)&&
      (!q||[row.player,row.team,row.opponent,row.stat].some(x=>String(x).toLowerCase().includes(q)))
    );
  },[result,coreOnly,search]);
  const time=ts=>new Date(ts).toLocaleString("en-US",{
    timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"
  });

  return (
    <section className="pp-free-mirror" aria-label="Free PrizePicks NFL research feed"
      style={{margin:"1.2rem 0",padding:"1.2rem",border:"1px solid var(--border, #536070)",borderRadius:"1rem"}}>
      <div style={{display:"flex",flexWrap:"wrap",gap:"0.8rem",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <p className="pp-analytics-label" style={{margin:"0 0 .25rem"}}>THIRD-PARTY PUBLIC MIRROR · NFL · RESEARCH ONLY</p>
          <h2 style={{margin:0}}>Today's free PrizePicks lines</h2>
          <p style={{margin:".35rem 0 0",opacity:.8}}>
            Standard lines only. Not verified live offers. No FBIS pick, star rating, or wagering authority.
          </p>
        </div>
        <a href={FREE_NFL_MIRROR_SOURCE_URL} target="_blank" rel="noreferrer" style={{textDecoration:"underline"}}>
          View original GitHub feed ↗
        </a>
      </div>
      {loading?<p>Checking today's free NFL board…</p>:null}
      {!loading&&error?(
        <div className="pp-empty error-text" role="status">
          {error}. No older mirror data will be substituted.
          <button type="button" onClick={()=>setRefresh(n=>n+1)} style={{marginLeft:12}}>Retry free feed</button>
        </div>
      ):null}
      {!loading&&result?.ok?(
        <>
          <div style={{margin:".8rem 0",display:"flex",flexWrap:"wrap",gap:12,fontSize:".88rem"}}>
            <span>Source observed: <strong>{time(result.observedAt)} CT</strong></span>
            <span>Published: {time(result.publishedAt)} CT</span>
            <span>{result.rows.length} upcoming standard props</span>
            <span>{result.coreRows} across FBIS six markets</span>
            <span>{result.excludedStarted} started-game rows hidden</span>
          </div>
          <div role="group" aria-label="Free mirror filters" style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:10,marginBottom:12}}>
            <label>
              <span style={{marginRight:8}}>Markets</span>
              <select value={coreOnly?"core":"all"} onChange={e=>{setCoreOnly(e.target.value==="core");setLimit(48);}}>
                <option value="core">Six NFL research markets</option>
                <option value="all">All published standard markets</option>
              </select>
            </label>
            <label>
              <span style={{marginRight:8}}>Find</span>
              <input type="search" placeholder="Player, team, market" value={search}
                onChange={e=>{setSearch(e.target.value);setLimit(48);}} style={{maxWidth:220}}/>
            </label>
            <button type="button" onClick={()=>setRefresh(n=>n+1)}>Refresh mirror</button>
            <span style={{opacity:.8}}>{rows.length} results</span>
          </div>
          {rows.length?(
            <>
              <div className="pp-card-grid pp-premium-grid pp-mirror-grid">
                {rows.slice(0,limit).map(row=>(
                  <article key={row.id} className="pp-card pp-premium-card sport-nfl pp-mirror-card">
                    <div className="pp-card-visual pp-mirror-visual">
                      <div className="pp-watermark" aria-hidden="true">{row.team||"NFL"}</div>
                      <span className="pp-mirror-research-badge">PUBLIC MIRROR · RESEARCH</span>
                      <div className="pp-mirror-player-initials" aria-hidden="true">
                        {String(row.player||"?").split(/\\s+/).slice(0,2).map(n=>n[0]||"").join("").toUpperCase()}
                      </div>
                      <div className="pp-team-pill">NFL · {row.team||"TEAM"}</div>
                    </div>
                    <div className="pp-card-body">
                      <div className="pp-player-title">
                        <h3>{row.player}</h3>
                        <p>{row.team} · vs <b>{row.opponent}</b></p>
                      </div>
                      <div className="pp-market-name pp-premium-market-name">{row.stat}</div>
                      <div className="pp-mirror-line-block">
                        <span>PUBLIC STANDARD LINE</span>
                        <strong>{row.line}</strong>
                        <small>Not a verified live offer</small>
                      </div>
                      <div className="pp-card-foot pp-premium-foot">
                        <span>{time(row.startAt)} CT</span>
                        <span>Research only · No FBIS pick</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {rows.length>limit?(
                <button type="button" onClick={()=>setLimit(n=>n+48)}
                  style={{marginTop:12}}>Show more ({rows.length-limit} remaining)</button>
              ):null}
            </>
          ):<p>No unstarted matching lines for this market filter.</p>}
          <p style={{fontSize:".82rem",opacity:.8,marginTop:12}}>
            Source: publicly readable independent GitHub mirror; terms/data rights not independently licensed by FBIS.
            Provider IDs are not canonical FBIS game IDs. This board is not a market execution feed,
            is not saved as an immutable prospective state snapshot, and is excluded from betting decisions.
          </p>
        </>
      ):null}
    </section>
  );
}
