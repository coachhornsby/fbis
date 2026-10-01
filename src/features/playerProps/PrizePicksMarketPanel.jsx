import { useEffect, useMemo, useState } from "react";

const SPORTS=["all","mlb","tennis","nba","wnba","nfl","nhl","soccer","cfb","cbb"];
const TIER_ORDER={standard:0,goblin:1,demon:2};
function num(v){ return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "—"; }
function tierClass(tier=""){ return "pp-tier-"+String(tier||"standard").toLowerCase().replace(/[^a-z0-9]+/g,"-"); }
function initials(name=""){ return String(name).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"PP"; }
function marketLabel(r){ return String(r.canonical_market||r.stat_type||"PROP").replaceAll("_"," "); }
function matchupLabel(r){
  const team=String(r.team||"").trim();
  const opponent=String(r.opponent||"").trim();
  if(team&&opponent) return team+" · vs "+opponent;
  if(team) return team+" · Matchup pending";
  return opponent ? "vs "+opponent : "Matchup pending";
}
function groupLatest(rows=[]){
  const newest=new Map();
  for(const r of rows){
    const tier=String(r.odds_tier||"standard").toLowerCase();
    const key=[r.sport,r.player_name,r.canonical_market||r.stat_type,r.duration||"full"].join("|");
    if(!newest.has(key)) newest.set(key,{key,variants:new Map()});
    const g=newest.get(key);
    if(!g.variants.has(tier)) g.variants.set(tier,r);
  }
  return [...newest.values()].map(g=>{
    const variants=[...g.variants.values()].sort((a,b)=>(TIER_ORDER[String(a.odds_tier||"standard").toLowerCase()]??9)-(TIER_ORDER[String(b.odds_tier||"standard").toLowerCase()]??9));
    const primary=variants.find(v=>String(v.odds_tier||"standard").toLowerCase()==="standard")||variants[0];
    return {...g,primary,variants};
  }).slice(0,120);
}

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

  const groups=useMemo(()=>groupLatest(rows),[rows]);

  return (
    <section className="pp-market" aria-label="PrizePicks player props">
      <div className="pp-hero">
        <div>
          <div className="pp-kicker">FBIS × PRIZEPICKS MARKET</div>
          <h1>PLAYER PROPS</h1>
          <p>One card per player and market. Standard, Goblin and Demon variants are grouped under the same FBIS projection.</p>
        </div>
        <div className="pp-count">{loading?"LOADING":groups.length+" MARKETS"}</div>
      </div>
      <div className="pp-sport-strip" role="group" aria-label="Player prop sport filter">
        {SPORTS.map(s=><button key={s} className={localSport===s?"active":""} onClick={()=>setLocalSport(s)}>{s.toUpperCase()}</button>)}
      </div>
      {error?<div className="pp-empty error-text">{error}</div>:null}
      {!loading&&!error&&!groups.length?<div className="pp-empty">No curated PrizePicks observations are stored for this filter yet.</div>:null}
      <div className="pp-card-grid">
        {groups.map((group)=>{
          const r=group.primary;
          return (
            <article className={"pp-card "+tierClass(r.odds_tier)} key={group.key}>
              <div className="pp-card-top">
                <span className="pp-sport">{String(r.sport||"").toUpperCase()}</span>
                <span className="pp-tier">{group.variants.length>1?group.variants.length+" LINES":String(r.odds_tier||"STANDARD").toUpperCase()}</span>
              </div>
              <div className="pp-player">
                <div className="pp-headshot">
                  {r.player_headshot_url?<img src={r.player_headshot_url} alt="" loading="lazy" referrerPolicy="no-referrer" />:<span>{initials(r.player_name)}</span>}
                </div>
                <div className="pp-player-copy">
                  <h2>{r.player_name||"Unknown player"}</h2>
                  <div>{matchupLabel(r)}</div>
                </div>
              </div>
              <div className="pp-market-name">{marketLabel(r)}</div>
              {group.variants.map((v)=>{
                const side=v.candidate_side||"WATCH";
                const diff=v.delta_fbis_minus_line;
                return (
                  <div className="pp-variant" key={v.id||v.projection_id||String(v.odds_tier)+"-"+String(v.line)}>
                    <div className="pp-variant-label">
                      <b>{String(v.odds_tier||"standard").toUpperCase()}</b>
                      <span>{String(v.duration||"FULL GAME").toUpperCase()}</span>
                    </div>
                    <div className="pp-line-row">
                      <div><span>PRIZEPICKS</span><strong>{v.line??"—"}</strong></div>
                      <div><span>FBIS</span><strong>{v.fbis_projection==null?"—":num(v.fbis_projection)}</strong></div>
                      <div><span>DIFF</span><strong>{diff==null?"—":((Number(diff)>0?"+":"")+num(diff))}</strong></div>
                    </div>
                    <div className={"pp-read pp-read-"+String(side).toLowerCase()}>
                      <span>FBIS READ</span><b>{side}</b>
                    </div>
                  </div>
                );
              })}
              <div className="pp-card-foot">
                <span>{r.opponent?"MATCHED":"MATCHUP PENDING"}</span>
                <span>{r.collected_at?new Date(r.collected_at).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"—"}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
