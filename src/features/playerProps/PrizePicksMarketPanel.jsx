import { useEffect, useMemo, useState } from "react";
import { propProjectionStars } from "./buildPlayerPropsBoard.js";

const SPORTS=["top25","nfl","mlb","cfb","cbb","tennis","nba","wnba","nhl","soccer"];
const TIER_ORDER={standard:0,goblin:1,demon:2};

function num(v){
  return Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "—";
}
function signed(v){
  if(!Number.isFinite(Number(v))) return "—";
  const n=Number(v);
  return (n>0?"+":"")+n.toFixed(1);
}
function initials(name=""){
  return String(name).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"PP";
}
function isRealHeadshot(url=""){
  const u=String(url||"").trim();
  return /^https?:\/\//i.test(u) && !/\/images\/teams\//i.test(u);
}
function resolvedHeadshot(row={}){
  if(isRealHeadshot(row.player_headshot_url)) return row.player_headshot_url;
  const q=new URLSearchParams({
    name:String(row.player_name||""),
    sport:String(row.sport||""),
    team:String(row.team||""),
    mode:"image",
  });
  return "/api/player-image?"+q.toString();
}
function marketLabel(r){
  return String(r.canonical_market||r.stat_type||"PROP")
    .replaceAll("_"," ")
    .replace(/\b\w/g,(m)=>m.toUpperCase());
}
function rowStars(r){
  const s=Number(r?.confidence_stars);
  return Number.isFinite(s)&&s>=1&&s<=5?s:propProjectionStars(r);
}
function sideFor(row={}){
  if(row.candidate_side) return String(row.candidate_side).toUpperCase();
  const p=Number(row.fbis_projection), l=Number(row.line);
  if(!Number.isFinite(p)||!Number.isFinite(l)) return "WATCH";
  return p>l?"MORE":p<l?"LESS":"WATCH";
}
function normalCdf(x){
  const sign=x<0?-1:1;
  const a=Math.abs(x)/Math.sqrt(2);
  const t=1/(1+0.3275911*a);
  const erf=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a);
  return 0.5*(1+sign*erf);
}
function hitProbability(row={}){
  const p=Number(row.fbis_projection), l=Number(row.line), s=Number(row.fbis_sigma);
  if(!Number.isFinite(p)||!Number.isFinite(l)||!Number.isFinite(s)||s<=0) return null;
  const z=(p-l)/s;
  const side=sideFor(row);
  const prob=side==="MORE"?normalCdf(z):side==="LESS"?normalCdf(-z):0.5;
  return Math.max(0,Math.min(1,prob));
}
function formatHit(row={}){
  const p=hitProbability(row);
  return p==null?"—":Math.round(p*100)+"%";
}
function matchupLabel(r){
  const team=String(r.team||"").trim();
  const opponent=String(r.opponent||"").trim();
  if(team&&opponent) return team+" · vs "+opponent;
  if(team) return team;
  return opponent ? "vs "+opponent : "Matchup pending";
}
function gameTime(r){
  if(!r?.start_time) return "";
  const d=new Date(r.start_time);
  if(!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("en-US",{
    timeZone:"America/Chicago",
    weekday:"short",
    hour:"numeric",
    minute:"2-digit",
  });
}
function PlayerPosition({ name, sport, team }){
  const [position,setPosition]=useState("");
  useEffect(()=>{
    let cancelled=false;
    const player=String(name||"").trim();
    const s=String(sport||"").trim().toLowerCase();
    if(!player||!s||s==="tennis"){
      setPosition("");
      return ()=>{cancelled=true};
    }
    const q=new URLSearchParams({name:player,sport:s,team:String(team||"")});
    fetch("/api/player-meta?"+q.toString(),{credentials:"same-origin"})
      .then(r=>r.ok?r.json():null)
      .then(body=>{
        if(cancelled) return;
        setPosition(String(body?.position||"").trim());
      })
      .catch(()=>{if(!cancelled)setPosition("")});
    return()=>{cancelled=true};
  },[name,sport,team]);
  if(!position) return null;
  return <span className="pp-player-position"> · {position}</span>;
}
function TeamWatermark({ sport, team }){
  const [logo,setLogo]=useState("");
  useEffect(()=>{
    let cancelled=false;
    const s=String(sport||"").toLowerCase();
    const t=String(team||"").trim();
    if(!s||!t||s==="tennis"){
      setLogo("");
      return ()=>{cancelled=true};
    }
    const q=new URLSearchParams({sport:s,name:t});
    fetch("/api/team-logo?"+q.toString(),{credentials:"same-origin"})
      .then(r=>r.ok?r.json():null)
      .then(body=>{
        if(cancelled) return;
        const u=body?.found?String(body?.team?.logo||""):"";
        setLogo(/^https?:\/\//i.test(u)?u:"");
      })
      .catch(()=>{if(!cancelled)setLogo("")});
    return()=>{cancelled=true};
  },[sport,team]);

  if(!logo) return null;
  return (
    <div className="pp-team-watermark" aria-hidden="true">
      <img src={logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"/>
    </div>
  );
}

function groupLatest(rows=[]){
  const newest=new Map();
  for(const r of rows){
    if(rowStars(r)==null) continue;
    const tier=String(r.odds_tier||"standard").toLowerCase();
    const key=[r.sport,r.player_name,r.canonical_market||r.stat_type,r.duration||"full"].join("|");
    if(!newest.has(key)) newest.set(key,{key,variants:new Map()});
    const g=newest.get(key);
    if(!g.variants.has(tier)) g.variants.set(tier,r);
  }
  return [...newest.values()].map(g=>{
    const variants=[...g.variants.values()].sort((a,b)=>
      (TIER_ORDER[String(a.odds_tier||"standard").toLowerCase()]??9)-
      (TIER_ORDER[String(b.odds_tier||"standard").toLowerCase()]??9)
    );
    const standard=variants.find((v)=>String(v.odds_tier||"standard").toLowerCase()==="standard");
    const primary=standard||variants[0];
    return {...g,primary,variants};
  });
}

function tierLabel(row={}){
  const tier=String(row.odds_tier||"standard").toLowerCase();
  if(tier==="goblin") return "GOBLIN";
  if(tier==="demon") return "DEMON";
  return "STANDARD";
}


function VariantMetrics({ group }){
  const variants=group?.variants||[];
  const defaultTier=String(group?.primary?.odds_tier||"standard").toLowerCase();
  const [tier,setTier]=useState(defaultTier);
  const active=variants.find((v)=>String(v.odds_tier||"standard").toLowerCase()===tier)
    || group?.primary
    || variants[0];
  if(!active) return null;
  const side=sideFor(active);
  const diff=active.delta_fbis_minus_line ?? (Number(active.fbis_projection)-Number(active.line));
  const hasAlternates=variants.length>1;

  return (
    <div className="pp-variant-shell">
      <div className="pp-tier-control-row">
        <span className={"pp-active-tier pp-active-tier-"+String(active.odds_tier||"standard").toLowerCase()}>
          {tierLabel(active)}
        </span>
        {hasAlternates ? (
          <label className="pp-tier-select-wrap">
            <span>Line type</span>
            <select
              className="pp-tier-select"
              value={String(active.odds_tier||"standard").toLowerCase()}
              onChange={(e)=>setTier(e.target.value)}
              aria-label="PrizePicks line type"
            >
              {variants.map((v)=>(
                <option
                  key={v.id||v.projection_id||String(v.odds_tier)+"-"+String(v.line)}
                  value={String(v.odds_tier||"standard").toLowerCase()}
                >
                  {tierLabel(v)} · {v.line??"—"}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="pp-line-row pp-premium-metrics">
        <div>
          <span>PP LINE</span>
          <strong>{active.line??"—"}</strong>
        </div>
        <div className="fbis-metric">
          <span>FBIS</span>
          <strong>{active.fbis_projection==null?"—":num(active.fbis_projection)}</strong>
        </div>
        <div>
          <span>HIT %</span>
          <strong>{formatHit(active)}</strong>
        </div>
      </div>

      <div className={"pp-read pp-premium-read pp-read-"+String(side).toLowerCase()}>
        <div className="pp-read-side">
          <span className="pp-read-arrow" aria-hidden="true">{side==="LESS"?"↓":"↑"}</span>
          <b>{side}</b>
        </div>
        <div className="pp-edge-value">
          <span>EDGE</span>
          <strong>{signed(diff)}</strong>
        </div>
      </div>
    </div>
  );
}

function StarRating({ stars=1 }){
  const safe=Math.max(1,Math.min(5,Number(stars)||1));
  return (
    <div className={"pp-premium-stars pp-stars-"+safe} aria-label={safe+" out of 5 stars"}>
      <span className="pp-star-icons" aria-hidden="true">
        {Array.from({length:5},(_,i)=><span key={i} className={i<safe?"filled":"empty"}>★</span>)}
      </span>
    </div>
  );
}

export default function PrizePicksMarketPanel({ sportFilter="top25", onSportFilterChange }){
  const [rows,setRows]=useState([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [freshness,setFreshness]=useState(null);
  const [localSport,setLocalSport]=useState(
    String(sportFilter||"top25").toLowerCase()==="all"?"top25":String(sportFilter||"top25").toLowerCase()
  );

  useEffect(()=>{
    const next=String(sportFilter||"top25").toLowerCase();
    setLocalSport(next==="all"?"top25":next);
  },[sportFilter]);

  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    setError("");
    const date=new Intl.DateTimeFormat("en-CA",{
      timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"
    }).format(new Date());
    const isTop=localSport==="top25";
    const q=new URLSearchParams({date,mode:isTop?"top25":"sport"});
    if(!isTop) q.set("sport",localSport);
    fetch("/api/selective-props?"+q.toString(),{credentials:"same-origin"})
      .then(async res=>{
        const j=await res.json().catch(()=>({}));
        if(!res.ok||j?.ok===false) throw new Error(j?.error||("HTTP "+res.status));
        return j;
      })
      .then(j=>{
        if(cancelled) return;
        setRows(Array.isArray(j.rows)?j.rows:[]);
        setFreshness(j.freshness||null);
      })
      .catch(e=>{
        if(cancelled) return;
        setRows([]);
        setError(String(e?.message||e));
      })
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

  const title=localSport==="top25"?"Top 25":localSport.toUpperCase();
  const subtitle=localSport==="top25"
    ?"Best projected FBIS player-prop edges today"
    :localSport==="nfl"
      ?"Only 4★+ NFL Standard-line edges, plus all 49ers QB1/RB1/WR1/WR2/TE1 projections"
      :"Every "+localSport.toUpperCase()+" prop with a valid FBIS projection";

  return (
    <section className="pp-market pp-premium-page" aria-label="FBIS player props">
      <header className="pp-premium-header">
        <div className="pp-premium-brand">
          <div className="pp-premium-mark" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <div>
            <div className="pp-premium-brandline">FBIS</div>
            <h1>Player Props</h1>
          </div>
        </div>
        <div className="pp-premium-live"><i></i> LIVE</div>
      </header>

      <nav className="pp-sport-strip pp-premium-tabs" aria-label="Player prop sport filter">
        {SPORTS.map(s=>(
          <button
            key={s}
            className={localSport===s?"active":""}
            onClick={()=>{setLocalSport(s);onSportFilterChange?.(s)}}
          >
            {s==="top25"?"TOP 25":s.toUpperCase()}
          </button>
        ))}
      </nav>

      <div className="pp-premium-section-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="pp-count pp-premium-count">
          {loading?"LOADING":groups.length+" PROPS"}
        </div>
      </div>

      {freshness?.stale?
        <div className="pp-empty error-text">Today's PrizePicks acquisition has not completed. Stale prior-day props are hidden.</div>
      :null}
      {error?<div className="pp-empty error-text">{error}</div>:null}
      {!loading&&!error&&!groups.length?
        <div className="pp-empty pp-premium-empty">No projected props are available for this tab yet.</div>
      :null}

      <div className="pp-card-grid pp-premium-grid">
        {groups.map((group)=>{
          const r=group.primary;
          const stars=rowStars(r);
          const sport=String(r.sport||"").toLowerCase();
          const team=String(r.team||"").trim();
          const opponent=String(r.opponent||"").trim();
          const time=gameTime(r);

          return (
            <article className={"pp-card pp-premium-card sport-"+sport+(stars===5?" pp-five-star":"")} key={group.key}>
              <div className="pp-card-visual">
                <TeamWatermark sport={sport} team={team}/>
                <StarRating stars={stars}/>

                <div className="pp-premium-headshot">
                  <img
                    src={resolvedHeadshot(r)}
                    alt={r.player_name?String(r.player_name):"Player"}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={(e)=>{
                      e.currentTarget.style.display="none";
                      const fallback=e.currentTarget.nextElementSibling;
                      if(fallback) fallback.style.display="flex";
                    }}
                  />
                  <span style={{display:"none"}}>{initials(r.player_name)}</span>
                </div>

                <div className="pp-team-pill">
                  {String(r.sport||"").toUpperCase()}
                  {team?<><span>•</span>{team}</>:null}
                </div>
              </div>

              <div className="pp-card-body">
                <div className="pp-player-title">
                  <h3>{r.player_name||"Unknown player"}<PlayerPosition name={r.player_name} sport={sport} team={team}/></h3>
                  <p>
                    {team||sport.toUpperCase()}
                    {opponent?<><span> vs </span><b>{opponent}</b></>:null}
                    {time?<><em> · {time}</em></>:null}
                  </p>
                </div>

                <div className="pp-market-name pp-premium-market-name">{marketLabel(r)}</div>

                <VariantMetrics group={group}/>

                <div className="pp-card-foot pp-premium-foot">
                  <span>{matchupLabel(r)}</span>
                  <span>{r.collected_at?new Date(r.collected_at).toLocaleString("en-US",{
                    timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"
                  }):"—"}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
