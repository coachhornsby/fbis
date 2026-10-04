import { useEffect, useMemo, useState } from "react";
import { propProjectionStars } from "./buildPlayerPropsBoard.js";

const SPORTS=["top25","mlb","tennis","nba","wnba","nfl","nhl","soccer","cfb","cbb"];
const TIER_ORDER={standard:0,goblin:1,demon:2};
function num(v){ return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "—"; }
function tierClass(tier=""){ return "pp-tier-"+String(tier||"standard").toLowerCase().replace(/[^a-z0-9]+/g,"-"); }
function initials(name=""){ return String(name).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"PP"; }
function isRealHeadshot(url=""){
  const u=String(url||"").trim();
  return /^https?:\/\//i.test(u) && !/\/images\/teams\//i.test(u);
}
function resolvedHeadshot(row={}){
  if(isRealHeadshot(row.player_headshot_url)) return row.player_headshot_url;
  const q=new URLSearchParams({
    name:String(row.player_name||""),
    sport:String(row.sport||""),
    mode:"image",
  });
  return "/api/player-image?"+q.toString();
}
function marketLabel(r){ return String(r.canonical_market||r.stat_type||"PROP").replaceAll("_"," "); }
function rowStars(r){ const s=Number(r?.confidence_stars); return Number.isFinite(s)&&s>=1&&s<=5?s:propProjectionStars(r); }
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
    if (rowStars(r) == null) continue;
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
  });
}

export default function PrizePicksMarketPanel({ sportFilter = "top25", onSportFilterChange }) {
  const [rows,setRows]=useState([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [freshness,setFreshness]=useState(null);
  const [localSport,setLocalSport]=useState(String(sportFilter||"top25").toLowerCase()==="all"?"top25":String(sportFilter||"top25").toLowerCase());
  useEffect(()=>{
    const next=String(sportFilter||"top25").toLowerCase();
    setLocalSport(next==="all"?"top25":next);
  },[sportFilter]);

  useEffect(()=>{
    let cancelled=false;
    setLoading(true); setError("");
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const isTop=localSport==="top25";
    const q=new URLSearchParams({date,mode:isTop?"top25":"sport"});
    if(!isTop) q.set("sport",localSport);
    fetch("/api/selective-props?"+q.toString(),{credentials:"same-origin"})
      .then(async res=>{const j=await res.json().catch(()=>({}));if(!res.ok||j?.ok===false)throw new Error(j?.error||("HTTP "+res.status));return j})
      .then(j=>{if(!cancelled){setRows(Array.isArray(j.rows)?j.rows:[]);setFreshness(j.freshness||null)}})
      .catch(e=>{if(!cancelled){setRows([]);setError(String(e?.message||e))}})
      .finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[localSport]);

  const groups=useMemo(
    ()=>groupLatest(rows).sort((a,b)=>{
      const byStars=(rowStars(b.primary)||0)-(rowStars(a.primary)||0);
      if(byStars) return byStars;
      const bz=Math.abs(Number(b.primary?.standardized_edge ?? b.primary?.selection_score ?? 0));
      const az=Math.abs(Number(a.primary?.standardized_edge ?? a.primary?.selection_score ?? 0));
      return bz-az;
    }),
    [rows]
  );

  return (
    <section className="pp-market" aria-label="PrizePicks player props">
      <div className="pp-hero">
        <div>
          <div className="pp-kicker">FBIS × PRIZEPICKS MARKET</div>
          <h1>PLAYER PROPS</h1>
          <p>
            {localSport==="top25"
              ?"Top 25 FBIS player-prop edges across all sports, ranked by stars and projection edge."
              :"Every current "+localSport.toUpperCase()+" prop with a valid FBIS projection, ranked highest stars first."}
          </p>
        </div>
        <div className="pp-count">{loading?"LOADING":groups.length+" MARKETS"}</div>
      </div>
      <div className="pp-sport-strip" role="group" aria-label="Player prop sport filter">
        {SPORTS.map(s=><button key={s} className={localSport===s?"active":""} onClick={()=>{setLocalSport(s);onSportFilterChange?.(s);}}>{s==="top25"?"TOP 25":s.toUpperCase()}</button>)}
      </div>
      {freshness?.stale?<div className="pp-empty error-text">Today's PrizePicks acquisition has not completed. Stale prior-day props are hidden.</div>:null}
      {error?<div className="pp-empty error-text">{error}</div>:null}
      {!loading&&!error&&!groups.length?<div className="pp-empty">No PrizePicks props with an FBIS projection are available for this tab yet.</div>:null}
      <div className="pp-card-grid">
        {groups.map((group)=>{
          const r=group.primary;
          const stars=rowStars(r);
          return (
            <article className={"pp-card "+tierClass(r.odds_tier)} key={group.key}>
              <div className="pp-card-top">
                <span className="pp-sport">{String(r.sport||"").toUpperCase()}</span>
                <span className="pp-tier" aria-label={stars+" star projection confidence"}>
                  {stars ? "★".repeat(stars)+"☆".repeat(5-stars) : ""}
                </span>
              </div>
              <div className="pp-player">
                <div className="pp-headshot">
                  <img
                    src={resolvedHeadshot(r)}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(e)=>{
                      e.currentTarget.style.display="none";
                      const fallback=e.currentTarget.nextElementSibling;
                      if(fallback) fallback.style.display="inline-flex";
                    }}
                  />
                  <span style={{display:"none"}}>{initials(r.player_name)}</span>
                </div>
                <div className="pp-player-copy">
                  <h2>{r.player_name||"Unknown player"}</h2>
                  <div>{matchupLabel(r)}</div>
                </div>
              </div>
              <div className="pp-market-name">{marketLabel(r)}</div>
              {group.variants.filter((v)=>rowStars(v)!=null).map((v)=>{
                const side=v.candidate_side||(
                  Number(v.fbis_projection)>Number(v.line)?"MORE":
                  Number(v.fbis_projection)<Number(v.line)?"LESS":"WATCH"
                );
                const diff=v.delta_fbis_minus_line ?? (Number(v.fbis_projection)-Number(v.line));
                const variantStars=rowStars(v);
                return (
                  <div className="pp-variant" key={v.id||v.projection_id||String(v.odds_tier)+"-"+String(v.line)}>
                    <div className="pp-variant-label">
                      <b>{String(v.odds_tier||"standard").toUpperCase()}</b>
                      <span>
                        {String(v.duration||"FULL GAME").toUpperCase()} · {"★".repeat(variantStars)}{"☆".repeat(5-variantStars)}
                      </span>
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
