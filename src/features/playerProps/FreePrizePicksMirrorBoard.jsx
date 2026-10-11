import {useEffect,useMemo,useRef,useState} from "react";
import {
  FREE_NFL_MIRROR_URL,FREE_NFL_MIRROR_SOURCE_URL,
  normalizeFreeNflMirror,mirrorChicagoDay,
} from "./freePrizePicksMirror.js";


const canonical=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9]+/g," ");
const nflTeamCode=v=>{const code=String(v||"").trim().toUpperCase();return ({JAC:"JAX",SFO:"SF",WSH:"WAS",LA:"LAR",STL:"LAR",OAK:"LV",SD:"LAC",ARZ:"ARI"})[code]||code;};
function matchingProjection(row,projections){
 if(!row.market||!row.teamCode)return null;
 const found=projections.filter(p=>canonical(p.player_name||p.playerName)===canonical(row.player)&&canonical(p.canonical_market||p.stat_type||p.market)===canonical(row.market)&&nflTeamCode(p.team)===nflTeamCode(row.teamCode)&&String(p.odds_tier||"standard").toLowerCase()==="standard"&&String(p.duration||"full").toLowerCase()==="full");
 if(found.length!==1)return null;
 const p=found[0],value=p.fbis_projection??p.fbisProjection;
 return value!=null&&value!==""&&Number.isFinite(Number(value))?{value:Number(value),modelVersion:p.model_version||p.modelVersion||null}:null;
}

const teamCache=new Map();
function MirrorCard({row,time,projection}){
 const [team,setTeam]=useState(null);
 const [opponentTeam,setOpponentTeam]=useState(null);
 const [headshotFailed,setHeadshotFailed]=useState(false);
 const [expanded,setExpanded]=useState(false);
 const [history,setHistory]=useState({state:"IDLE",games:[],rank:null,passDefense:null,runDefense:null});
 const cardRef=useRef(null);
 const [visible,setVisible]=useState(false);
 useEffect(()=>{
  if(typeof IntersectionObserver==="undefined"){setVisible(true);return}
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:"350px"});
  if(cardRef.current)observer.observe(cardRef.current);
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  let active=true;
  const key=String(row.team||"").trim();
  if(!teamCache.has(key)){
   const q=new URLSearchParams({sport:"nfl",name:key});
   teamCache.set(key,fetch("/api/team-logo?"+q,{credentials:"same-origin"})
    .then(r=>r.ok?r.json():null).then(x=>x?.found?x.team:null).catch(()=>null));
  }
  teamCache.get(key).then(t=>{if(active)setTeam(t)});
  return()=>{active=false};
 },[row.team]);
 useEffect(()=>{
  let active=true;
  const key=String(row.opponent||"").trim();
  if(!key){setOpponentTeam(null);return}
  const cacheKey="opponent:"+key;
  if(!teamCache.has(cacheKey)){
   const q=new URLSearchParams({sport:"nfl",name:key});
   teamCache.set(cacheKey,fetch("/api/team-logo?"+q,{credentials:"same-origin"})
    .then(r=>r.ok?r.json():null).then(x=>x?.found?x.team:null).catch(()=>null));
  }
  teamCache.get(cacheKey).then(t=>{if(active)setOpponentTeam(t)});
  return()=>{active=false};
 },[row.opponent]);
 useEffect(()=>{
  if(!visible||!row.market)return;
  let active=true;
  const q=new URLSearchParams({
   sport:"nfl",name:row.player,team:row.team,opponent:row.opponent,
   market:row.market||row.stat,line:String(row.line)
  });
  setHistory({state:"LOADING",games:[],rank:null,passDefense:null,runDefense:null});
  fetch("/api/player-prop-detail?"+q,{credentials:"same-origin"})
   .then(r=>r.ok?r.json():null)
   .then(x=>{
    if(!active)return;
    const games=Array.isArray(x?.detail?.last5)?x.detail.last5:[];
    const rank=Number(x?.detail?.matchup?.defenseRank);
    setHistory({state:games.length?"AVAILABLE":"UNAVAILABLE",games:games.slice(0,5),rank:Number.isInteger(rank)&&rank>=1&&rank<=32?rank:null,passDefense:x?.detail?.matchup?.passDefense||null,runDefense:x?.detail?.matchup?.runDefense||null});
   }).catch(()=>{if(active)setHistory({state:"UNAVAILABLE",games:[],rank:null,passDefense:null,runDefense:null})});
  return()=>{active=false};
 },[visible,row.id,row.market]);
 const imageUrl="/api/player-image?"+new URLSearchParams({name:row.player,sport:"nfl",team:row.team,mode:"image"});
 const primary=team?.primaryColor||"#172b50",secondary=team?.secondaryColor||"#090f20";
 const market=String(row.market||"").toLowerCase();
 const isRun=/^(rushing_|rush_|carries)/.test(market);
 const defenseType=isRun?"RUN":"PASS";
 const defenseRank=isRun?history.runDefense:history.passDefense;
 const defenseTier=defenseRank?.rank>=1&&defenseRank.rank<=10?"top-ten":defenseRank?.rank>=21&&defenseRank.rank<=32?"bottom-twelve":"neutral";
 const delta=projection?projection.value-Number(row.line):null;
 return <article ref={cardRef} className="pp-card pp-premium-card sport-nfl pp-mirror-card"
  style={{"--mirror-primary":primary,"--mirror-secondary":secondary}}>
  <div className="pp-card-visual pp-mirror-visual">
   {team?.logo?<div className="pp-team-watermark" aria-hidden="true"><img src={team.logo} alt=""/></div>:null}
   <span className="pp-mirror-research-badge">PUBLIC MIRROR · RESEARCH</span>
   <div className="pp-premium-headshot">
    {!headshotFailed?<img src={imageUrl} alt={row.player} loading="lazy"
      onError={()=>setHeadshotFailed(true)}/>:null}
    {headshotFailed?<span style={{display:"flex"}}>{String(row.player||"?").split(/\\s+/).slice(0,2).map(n=>n[0]||"").join("").toUpperCase()}</span>:null}
   </div>
   <div className="pp-team-pill">NFL · {team?.abbr||row.team||"TEAM"}</div>
  </div>
  <div className="pp-card-body">
   <div className="pp-player-title"><h3>{row.player}</h3><p>{row.team} · vs <b>{row.opponent}</b></p></div>
   <div className="pp-market-name pp-premium-market-name">{row.stat}</div>
   <div className="pp-mirror-comparison" aria-label="PrizePicks line versus FBIS model projection">
    <div className="pp-mirror-comparison-cell"><span>PRIZEPICKS</span><strong>{row.line}</strong><img className="pp-mirror-prizepicks-logo" src="https://app.prizepicks.com/images/pp-logos/pp-logo.svg" alt="PrizePicks" loading="lazy" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display="none"}}/></div>
    <div className="pp-mirror-comparison-cell"><span>FBIS PROJ</span><strong>{projection?projection.value.toFixed(1):"—"}</strong></div>
    <div className={"pp-mirror-comparison-cell pp-mirror-delta "+(delta==null?"is-missing":delta>0?"is-positive":delta<0?"is-negative":"is-even")}><span>DIFFERENCE</span><strong>{delta==null?"—":(delta>0?"+":"")+delta.toFixed(1)}</strong></div>
   </div>
   <div className="pp-mirror-context"><div className={"pp-mirror-defense rank-"+defenseTier}><span className="pp-mirror-defense-logo">{opponentTeam?.logo?<img src={opponentTeam.logo} alt={row.opponent+" logo"} loading="lazy"/>:null}</span><span>{defenseType} DEFENSE</span><strong>{defenseRank?.rank?"#"+defenseRank.rank:"N/A"}</strong></div><small>{projection?"FBIS "+(projection.modelVersion||"model"):"No matching published FBIS projection"} · Public line not verified live</small></div>
   <div className="pp-card-foot pp-premium-foot"><span>{time(row.startAt)} CT</span><span>Research only · No FBIS pick</span></div>
   <div className="pp-analytics">
    <button type="button" className="pp-analytics-toggle" onClick={()=>setExpanded(v=>!v)}
     aria-expanded={expanded}>Last 5 games <span>{expanded?"⌃":"⌄"}</span></button>
    {expanded?<div className="pp-analytics-body">
     {history.state==="LOADING"?<p>Loading observed player history…</p>:null}
     {history.state==="UNAVAILABLE"?<p>Verified last-five-game statistics unavailable for this player and market.</p>:null}
     {history.state==="AVAILABLE"?<div className="pp-history-block">
      <div className="pp-history-head"><strong>LAST 5 · {row.stat}</strong></div>
      <div className="pp-history-bars">{history.games.map((g,i)=>{
       const value=g.value==null?NaN:Number(g.value);
       const valid=Number.isFinite(value);
       const numbers=history.games.map(v=>v.value==null?NaN:Number(v.value)).filter(Number.isFinite);
       const max=Math.max(1,Number(row.line)||0,...numbers);
       return <div className="pp-history-game" key={i}>
        <div className="pp-history-bar-wrap">
         {valid?<div className="pp-history-bar" style={{height:Math.max(5,value/max*100)+"%",background:value>Number(row.line)?"#38dd9e":"#fa7388"}}/>:null}
         <div className="pp-history-line" style={{bottom:Math.min(100,Number(row.line)/max*100)+"%"}}/>
        </div>
        <b>{valid?value:"—"}</b><span>{g.opponent||"—"}</span><small>{g.date||g.gameDate||""}</small>
       </div>;
      })}</div>
     </div>:null}
    </div>:null}
   </div>
  </div>
 </article>;
}

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
  const [projections,setProjections]=useState([]);
  const [projectionStatus,setProjectionStatus]=useState("LOADING");
  useEffect(()=>{
   let active=true;
   const q=new URLSearchParams({date:mirrorChicagoDay(new Date())});
   fetch("/api/nfl-mirror-projections?"+q,{credentials:"same-origin"})
    .then(r=>r.ok?r.json():null)
    .then(j=>{if(active){setProjections(j?.ok&&Array.isArray(j?.rows)?j.rows:[]);setProjectionStatus(j?.ok?(j.rows?.length?"AVAILABLE":"NONE"):"UNAVAILABLE")}})
    .catch(()=>{if(active){setProjections([]);setProjectionStatus("UNAVAILABLE")}});
   return()=>{active=false};
  },[refresh]);

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
            <span>Independent FBIS model: {projectionStatus==="LOADING"?"loading":projectionStatus==="AVAILABLE"?projections.length+" current candidates":projectionStatus==="NONE"?"no current projections":"unavailable"}</span>
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
                  <MirrorCard key={row.id} row={row} time={time} projection={matchingProjection(row,projections)}/>
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
