import { useEffect, useMemo, useState } from "react";

const SPORTS=["all","mlb","tennis","nba","wnba","nfl","nhl","soccer","cfb","cbb"];
function num(v){ return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "—"; }
function tierClass(tier=""){ return "pp-tier-"+String(tier||"standard").toLowerCase().replace(/[^a-z0-9]+/g,"-"); }
function initials(name=""){ return String(name).split(/\\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"PP"; }

export default function PrizePicksMarketPanel({ sportFilter = "all" }) {
  const [rows,setRows]=useState([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [localSport,setLocalSport]=useState(String(sportFilter||"all").toLowerCase());
  useEffect(()=>setLocalSport(String(sportFilter||"all").toLowerCase()),[sportFilter]);

  useEffect(()=>{
    let cancelled=false;
    setLoading(true); setError("");
    const q=new URLSearchParams({limit:"500"});
    if(localSport!=="all") q.set("sport",localSport);
    fetch("/api/prizepicks-props?"+q.toString(),{credentials:"same-origin"})
      .then(async res=>{const j=await res.json().catch(()=>({}));if(!res.ok||j?.ok===false)throw new Error(j?.error||("HTTP "+res.status));return j})
      .then(j=>{if(!cancelled)setRows(Array.isArray(j.rows)?j.rows:[])})
      .catch(e=>{if(!cancelled){setRows([]);setError(String(e?.message||e))}})
      .finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[localSport]);

  const latest=useMemo(()=>{
    const seen=new Set(),out=[];
    for(const r of rows){
      const key=[r.sport,r.player_name,r.canonical_market||r.stat_type,r.odds_tier].join("|");
      if(seen.has(key)) continue;
      seen.add(key); out.push(r);
    }
    return out.slice(0,120);
  },[rows]);

  return (
    <section className="pp-market" aria-label="PrizePicks player props">
      <div className="pp-hero">
        <div>
          <div className="pp-kicker">FBIS × PRIZEPICKS MARKET</div>
          <h1>PLAYER PROPS</h1>
          <p>Curated lines only. FBIS projection first; PrizePicks is the market reference. Research markets cannot qualify until validated.</p>
        </div>
        <div className="pp-count">{loading?"LOADING":latest.length+" LINES"}</div>
      </div>
      <div className="pp-sport-strip" role="group" aria-label="Player prop sport filter">
        {SPORTS.map(s=><button key={s} className={localSport===s?"active":""} onClick={()=>setLocalSport(s)}>{s.toUpperCase()}</button>)}
      </div>
      {error?<div className="pp-empty error-text">{error}</div>:null}
      {!loading&&!error&&!latest.length?<div className="pp-empty">No curated PrizePicks observations are stored for this filter yet.</div>:null}
      <div className="pp-card-grid">
        {latest.map((r,i)=>{
          const market=String(r.canonical_market||r.stat_type||"PROP").replaceAll("_"," ");
          const side=r.candidate_side||"WATCH";
          const diff=r.delta_fbis_minus_line;
          return (
            <article className={"pp-card "+tierClass(r.odds_tier)} key={r.id||(String(r.projection_id)+"-"+i)}>
              <div className="pp-card-top">
                <span className="pp-sport">{String(r.sport||"").toUpperCase()}</span>
                <span className="pp-tier">{r.odds_tier||"STANDARD"}</span>
              </div>
              <div className="pp-player">
                <div className="pp-headshot">
                  {r.player_headshot_url?<img src={r.player_headshot_url} alt="" loading="lazy" referrerPolicy="no-referrer" />:<span>{initials(r.player_name)}</span>}
                </div>
                <div className="pp-player-copy">
                  <h2>{r.player_name||"Unknown player"}</h2>
                  <div>{[r.team,r.opponent?("vs "+r.opponent):null].filter(Boolean).join(" · ")||"Matchup pending"}</div>
                </div>
              </div>
              <div className="pp-market-name">{market}</div>
              <div className="pp-line-row">
                <div><span>PRIZEPICKS</span><strong>{r.line??"—"}</strong></div>
                <div><span>FBIS</span><strong>{r.fbis_projection==null?"—":num(r.fbis_projection)}</strong></div>
                <div><span>DIFF</span><strong>{diff==null?"—":((Number(diff)>0?"+":"")+num(diff))}</strong></div>
              </div>
              <div className={"pp-read pp-read-"+String(side).toLowerCase()}>
                <span>FBIS READ</span><b>{side}</b>
              </div>
              <div className="pp-card-foot">
                <span>{r.duration||"FULL GAME"}</span>
                <span>{r.collected_at?new Date(r.collected_at).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"—"}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
