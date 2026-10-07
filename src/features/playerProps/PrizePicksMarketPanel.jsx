import { useEffect, useMemo, useState } from "react";
import { propProjectionStars } from "./buildPlayerPropsBoard.js";
import TrackedPropCards from "./TrackedPropCards.jsx";

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

function fmtStat(v){
  if(v==null||!Number.isFinite(Number(v))) return "—";
  const n=Number(v);
  return Math.abs(n)>=100?Math.round(n).toString():Number(n.toFixed(1)).toString();
}
function pct(v){
  if(v==null||!Number.isFinite(Number(v))) return "—";
  const n=Number(v);
  return Math.round((n<=1?n*100:n))+"%";
}
function trendClass(value,line){
  if(value==null||line==null) return "";
  const v=Number(value), l=Number(line);
  if(v>l) return "over";
  if(v<l) return "under";
  return "push";
}
function shortGameDate(g){
  const raw=g?.date;
  if(raw){
    const d=new Date(String(raw).length<=10?String(raw)+"T12:00:00":raw);
    if(!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-US",{month:"numeric",day:"numeric",timeZone:"America/Chicago"});
  }
  return g?.week?("W"+g.week):"—";
}
function modelReason(row,detail){
  const side=sideFor(row);
  const projection=Number(row?.fbis_projection);
  const line=Number(row?.line);
  const edge=projection-line;
  const bits=[];
  if(Number.isFinite(edge)) bits.push("FBIS projects "+num(projection)+" vs "+String(line)+" ("+signed(edge)+").");
  const l5=detail?.season?.recent5Average;
  if(Number.isFinite(Number(l5))) bits.push("Last-5 average: "+fmtStat(l5)+".");
  const season=detail?.season?.average;
  if(Number.isFinite(Number(season))) bits.push("Season average: "+fmtStat(season)+".");
  const mf=detail?.matchup?.matchupFactor;
  if(Number.isFinite(Number(mf))){
    const d=(Number(mf)-1)*100;
    bits.push("Opponent allows "+Math.abs(d).toFixed(0)+"% "+(d>=0?"more":"less")+" than league average to this position/stat.");
  }
  if(detail?.role?.snapShare!=null) bits.push("Snap share: "+pct(detail.role.snapShare)+".");
  if(row?.featureEvidence?.targetRoleName) bits.push("Role: "+row.featureEvidence.targetRoleName+".");
  if(side==="WATCH") bits.push("Model and line are effectively even.");
  return bits;
}
function advancedMetricRows(detail,row){
  const a=detail?.advanced||{};
  const market=String(row?.canonical_market||row?.stat_type||"").toLowerCase();
  const out=[];
  const add=(label,value,formatter=fmtStat)=>{
    if(value==null||!Number.isFinite(Number(value))) return;
    out.push({label,value:formatter(value)});
  };
  const sport=String(row?.sport||"").toLowerCase();
  if(sport==="mlb"){
    add("ERA",a.era,(v)=>Number(v).toFixed(2));
    add("WHIP",a.whip,(v)=>Number(v).toFixed(2));
    add("K / 9",a.strikeoutsPer9,(v)=>Number(v).toFixed(1));
    add("BB / 9",a.walksPer9,(v)=>Number(v).toFixed(1));
    add("H / 9",a.hitsPer9,(v)=>Number(v).toFixed(1));
    if(a.inningsPitched!=null&&a.gamesStarted){
      add("IP / Start",Number(a.inningsPitched)/Number(a.gamesStarted),(v)=>Number(v).toFixed(1));
    }
  } else if(market.startsWith("passing")||market==="completions"||market==="interceptions"){
    add("CPOE",a.cpoe,(v)=>Number(v).toFixed(1));
    add("Time to Throw",a.avgTimeToThrow,(v)=>Number(v).toFixed(2)+"s");
    add("Aggressiveness",a.aggressiveness,(v)=>Number(v).toFixed(1)+"%");
    add("Passer Rating",a.passerRating,(v)=>Number(v).toFixed(1));
  } else if(market.startsWith("rushing")){
    add("RYOE / Att",a.ryoePerAtt,(v)=>Number(v).toFixed(2));
    add("Rush Efficiency",a.rushEfficiency,(v)=>Number(v).toFixed(2));
    add("Time to LOS",a.avgTimeToLos,(v)=>Number(v).toFixed(2)+"s");
  } else if(market.startsWith("receiv")||market==="receptions"||market==="rec_targets"){
    add("Separation",a.avgSeparation,(v)=>Number(v).toFixed(2)+" yd");
    add("Cushion",a.avgCushion,(v)=>Number(v).toFixed(2)+" yd");
    add("Air Yards",a.avgIntendedAirYards,(v)=>Number(v).toFixed(1));
    add("YAC Over Exp",a.yacOverExpected,(v)=>Number(v).toFixed(2));
    add("Catch %",a.catchPct,(v)=>pct(v));
  }
  if(detail?.role?.snapShare!=null) out.push({label:"Snap Share",value:pct(detail.role.snapShare)});
  if(detail?.matchup?.matchupFactor!=null){
    out.push({label:"Matchup vs Avg",value:(((Number(detail.matchup.matchupFactor)-1)*100)>=0?"+":"")+((Number(detail.matchup.matchupFactor)-1)*100).toFixed(0)+"%"});
  }
  return out.slice(0,6);
}

function PropAnalytics({ row, open, onToggle }){
  const [state,setState]=useState({loading:false,error:"",body:null});
  useEffect(()=>{
    if(!open||state.body||state.loading) return;
    let cancelled=false;
    const q=new URLSearchParams({
      sport:String(row?.sport||""),
      name:String(row?.player_name||""),
      team:String(row?.team||""),
      opponent:String(row?.opponent||""),
      market:String(row?.canonical_market||row?.stat_type||""),
      line:String(row?.line??""),
      modelVersion:String(row?.model_version||""),
    });
    setState({loading:true,error:"",body:null});
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort("player-prop-detail-timeout"),18000);
    fetch("/api/player-prop-detail?"+q.toString(),{credentials:"same-origin",signal:controller.signal})
      .then(async res=>{
        const body=await res.json().catch(()=>({}));
        if(!res.ok||body?.ok===false) throw new Error(body?.error||("HTTP "+res.status));
        return body;
      })
      .then(body=>{clearTimeout(timer);if(!cancelled)setState({loading:false,error:"",body});})
      .catch(err=>{clearTimeout(timer);if(!cancelled)setState({loading:false,error:err?.name==="AbortError"?"History request timed out":String(err?.message||err),body:null});});
    return()=>{cancelled=true;clearTimeout(timer);controller.abort();};
  },[open,row]);

  const detail=state.body?.detail||null;
  const calibration=state.body?.calibration||null;
  const reasons=modelReason(row,detail);
  return (
    <div className={"pp-analytics"+(open?" open":"")}>
      <button type="button" className="pp-analytics-toggle" onClick={onToggle} aria-expanded={open}>
        <span>{open?"Hide analytics":"Why FBIS likes it"}</span>
        <span aria-hidden="true">{open?"⌃":"⌄"}</span>
      </button>
      {open?(
        <div className="pp-analytics-body">
          {state.loading?<div className="pp-analytics-loading">Loading player history…</div>:null}
          {state.error?<div className="pp-analytics-loading">Analytics unavailable: {state.error}</div>:null}
          {reasons.length?(
            <div className="pp-why-card">
              <div className="pp-analytics-label">FBIS READ</div>
              <ul>{reasons.map((x,i)=><li key={i}>{x}</li>)}</ul>
            </div>
          ):null}
          {detail?.last5?.length?(
            <div className="pp-history-block">
              <div className="pp-history-head">
                <div>
                  <div className="pp-analytics-label">LAST 5</div>
                  <strong>{marketLabel(row)}</strong>
                </div>
                <div className="pp-history-summary">
                  <span>L5 AVG</span><b>{fmtStat(detail?.season?.recent5Average ?? (detail.last5.reduce((s,g)=>s+(Number(g.value)||0),0)/detail.last5.length))}</b>
                </div>
              </div>
              <div className="pp-history-bars">
                {detail.last5.map((g,i)=>{
                  const value=Number(g.value);
                  const line=Number(row.line);
                  const max=Math.max(line*1.55,...detail.last5.map(x=>Number(x.value)||0),1);
                  const height=Math.max(8,Math.min(100,(value/max)*100));
                  return (
                    <div className="pp-history-game" key={i}>
                      <div className="pp-history-bar-wrap">
                        <div className={"pp-history-bar "+trendClass(value,line)} style={{height:height+"%"}}></div>
                        <div className="pp-history-line" style={{bottom:Math.min(95,(line/max)*100)+"%"}}></div>
                      </div>
                      <b>{fmtStat(value)}</b>
                      <span>{g.opponent||("G"+(i+1))}</span>
                      <small>{shortGameDate(g)}</small>
                    </div>
                  );
                })}
              </div>
              <div className="pp-history-legend"><span></span> PrizePicks line {row.line}</div>
            </div>
          ):null}
          {detail?.season?(
            <div className="pp-season-grid">
              <div><span>SEASON AVG</span><b>{fmtStat(detail.season.average)}</b></div>
              <div><span>GAMES</span><b>{fmtStat(detail.season.games)}</b></div>
              <div><span>FBIS PROJ</span><b>{fmtStat(row.fbis_projection)}</b></div>
              <div><span>PP LINE</span><b>{fmtStat(row.line)}</b></div>
            </div>
          ):null}
          {detail?.matchup?.opponentAllowed!=null?(
            <div className="pp-matchup-grid">
              <div>
                <span>OPP ALLOWED</span>
                <b>{fmtStat(detail.matchup.opponentAllowed)}</b>
              </div>
              <div>
                <span>LEAGUE AVG</span>
                <b>{fmtStat(detail.matchup.leagueAverageAllowed)}</b>
              </div>
              <div>
                <span>MATCHUP</span>
                <b>{detail.matchup.matchupFactor==null?"—":((Number(detail.matchup.matchupFactor)-1)*100).toFixed(0)+"%"}</b>
              </div>
            </div>
          ):null}
          {advancedMetricRows(detail,row).length?(
            <div className="pp-advanced-block">
              <div className="pp-analytics-label">ADVANCED STATS</div>
              <div className="pp-advanced-grid">
                {advancedMetricRows(detail,row).map((m)=>(
                  <div key={m.label}>
                    <span>{m.label}</span>
                    <b>{m.value}</b>
                  </div>
                ))}
              </div>
            </div>
          ):null}
          {calibration?(
            <div className="pp-calibration-row">
              <span>Model history</span>
              <b>{Number(calibration.decisions||0)} decisions · {pct(calibration.hit_rate)} hit · MAE {fmtStat(calibration.mae)}</b>
            </div>
          ):null}
          {!state.loading&&!state.error&&detail?.unavailable?(
            <div className="pp-analytics-unavailable">
              Player history unavailable in the current runtime snapshot. FBIS projection evidence remains shown above.
            </div>
          ):null}
          {!state.loading&&!state.error&&!detail?(
            <div className="pp-analytics-unavailable">
              Last-5 game logs are not available for this sport/market yet. FBIS projection evidence remains shown above.
            </div>
          ):null}
        </div>
      ):null}
    </div>
  );
}

export default function PrizePicksMarketPanel({ sportFilter="top25", onSportFilterChange }){
  const [rows,setRows]=useState([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [freshness,setFreshness]=useState(null);
  const [underdogRows,setUnderdogRows]=useState([]);
  const [expandedKey,setExpandedKey]=useState("");
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
    const primary=fetch("/api/selective-props?"+q.toString(),{credentials:"same-origin"});
    const ud=localSport==="tennis"
      ? fetch("/api/lines/underdog?sport=tennis&date="+encodeURIComponent(date),{credentials:"same-origin"}).then(r=>r.ok?r.json():null).catch(()=>null)
      : Promise.resolve(null);
    Promise.all([primary,ud]).then(async ([res,udBody])=>{
        const j=await res.json().catch(()=>({}));
        if(!res.ok||j?.ok===false) throw new Error(j?.error||("HTTP "+res.status));
        return {j,udBody};
      })
      .then(({j,udBody})=>{
        if(cancelled) return;
        setRows(Array.isArray(j.rows)?j.rows:[]);
        setFreshness(j.freshness||null);
        setUnderdogRows(Array.isArray(udBody?.lines)?udBody.lines:[]);
      })
      .catch(e=>{
        if(cancelled) return;
        setRows([]);
        setUnderdogRows([]);
        setError(String(e?.message||e));
      })
      .finally(()=>{if(!cancelled)setLoading(false)});
    return()=>{cancelled=true};
  },[localSport]);

  const groups=useMemo(
    ()=>groupLatest(rows).map(group=>{
      if(localSport!=="tennis") return group;
      const p=group.primary||{};
      const name=String(p.player_name||"").normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
      const market=String(p.canonical_market||p.stat_type||"").toLowerCase();
      const matches=underdogRows.filter(u=>u.usableForAutomatedComparison&&u.lineType!=="promo"&&u.lineType!=="discounted"&&u.lineType!=="alternate"&&String(u.playerName||"").normalize("NFKD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()===name&&String(u.statFamily||"").toLowerCase()===market);
      const standard=matches.find(u=>u.lineType==="standard")||matches.find(u=>u.lineType==="unknown")||null;
      return {...group,underdog:standard};
    }).sort((a,b)=>{
      const byStars=(rowStars(b.primary)||0)-(rowStars(a.primary)||0);
      if(byStars) return byStars;
      const bz=Math.abs(Number(b.primary?.standardized_edge ?? b.primary?.selection_score ?? 0));
      const az=Math.abs(Number(a.primary?.standardized_edge ?? a.primary?.selection_score ?? 0));
      return bz-az;
    }),
    [rows,underdogRows,localSport]
  );

  const title=localSport==="top25"?"Top 25":localSport.toUpperCase();
  const subtitle=localSport==="top25"
    ?"Best projected FBIS player-prop edges today"
    :localSport==="nfl"
      ?"Only 4★+ NFL Standard-line edges, plus all 49ers QB1/RB1/WR1/WR2/TE1 projections"
      :"Every "+localSport.toUpperCase()+" prop with a valid FBIS projection";

  return (
    <section className="pp-market pp-premium-page" aria-label="FBIS player props" data-display-policy="nfl-4star-tiers-v3">
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

      <TrackedPropCards sportFilter={localSport === "top25" ? "all" : localSport} />

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
            <article className={"pp-card pp-premium-card sport-"+sport+(stars===5?" pp-five-star":"")+(expandedKey===group.key?" pp-expanded":"")} key={group.key}>
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

                {sport==="tennis"?<div className="pp-card-foot pp-premium-foot"><span>Underdog {group.underdog?.line??"—"}{group.underdog&&Number.isFinite(Number(r.line))?` · Δ ${(Number(group.underdog.line)-Number(r.line)).toFixed(1)}`:""}</span><span>{group.underdog?.timestamp?new Date(group.underdog.timestamp).toLocaleTimeString("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"2-digit"}):"source unavailable"}</span></div>:null}

                <div className="pp-card-foot pp-premium-foot">
                  <span>{matchupLabel(r)}</span>
                  <span>{r.collected_at?new Date(r.collected_at).toLocaleString("en-US",{
                    timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"
                  }):"—"}</span>
                </div>
                <PropAnalytics
                  row={r}
                  open={expandedKey===group.key}
                  onToggle={()=>setExpandedKey((k)=>k===group.key?"":group.key)}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
