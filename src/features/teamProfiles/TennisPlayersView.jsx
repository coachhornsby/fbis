import {useEffect,useMemo,useState} from "react";
import "./tennisPlayers.css";

const TOUR_BRANDS=Object.freeze({
 wta:{label:"WTA",title:"Women's Tennis Association",logo:"https://commons.wikimedia.org/wiki/Special:FilePath/WTA_2025.svg"},
 atp:{label:"ATP",title:"ATP Tour",logo:"https://commons.wikimedia.org/wiki/Special:FilePath/ATP_Tour_logo.svg"}
});
const country2=code=>{
 const x=String(code||"").toUpperCase();
 const codes={USA:"US",GBR:"GB",ESP:"ES",FRA:"FR",ITA:"IT",GER:"DE",DEU:"DE",AUS:"AU",CAN:"CA",CHN:"CN",JPN:"JP",KOR:"KR",POL:"PL",SRB:"RS",CRO:"HR",HRV:"HR",CZE:"CZ",ARG:"AR",BRA:"BR",SUI:"CH",CHE:"CH",NED:"NL",NLD:"NL",BEL:"BE",AUT:"AT",GRE:"GR",UKR:"UA",ROU:"RO",KAZ:"KZ",NZL:"NZ",IND:"IN",TPE:"TW",UZB:"UZ"};
 return /^[A-Z]{2}$/.test(x)?x:codes[x]||"";
};
function Brand({tour,small=false}){
 const [failed,setFailed]=useState(false),b=TOUR_BRANDS[tour]||TOUR_BRANDS.wta;
 return <span className={`tp-tour-brand ${small?"tp-small":""} tp-brand-${tour}`} title={b.title}>
   {!failed?<img src={b.logo} alt={b.label+" Tour logo"} loading="lazy" onError={()=>setFailed(true)}/>:null}
   <strong className={failed?"tp-logo-fallback":"tp-brand-text"}>{b.label}</strong>
 </span>;
}
function Headshot({player}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>{setFailed(false)},[player.portraitUrl,player.playerId]);
 return <div className="tp-player-image">{player.portraitUrl&&!failed?
   <img src={player.portraitUrl} alt={player.name+" portrait"} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:
   <div className="tp-avatar-fallback" role="img" aria-label="Player portrait unavailable">
     <svg viewBox="0 0 100 120" aria-hidden="true"><circle cx="50" cy="34" r="21" fill="currentColor"/><path d="M8 116V98c0-25 19-40 42-40s42 15 42 40v18Z" fill="currentColor"/></svg>
   </div>}
   <span className="tp-image-status">{player.portraitSource==="APPROVED_R2"?"FBIS ARCHIVE":player.portraitUrl?"PHOTO LINK":"PHOTO PENDING"}</span>
 </div>;
}
function PlayerCard({player}){
 const country=country2(player.countryCode),neutral=["RU","BY","AIN"].includes(String(player.countryCode||"").toUpperCase());
 return <article className="tp-player-card">
  <Headshot player={player}/>
  <div className="tp-player-info">
    <div className="tp-player-top"><Brand tour={player.tour} small/>{player.rank!=null?<span className="tp-ranking">#{player.rank}</span>:<span className="tp-unranked">UNRANKED</span>}</div>
    <h3>{player.name}</h3>
    <div className="tp-player-country">{country&&!neutral?<img src={`https://flagcdn.com/w80/${country.toLowerCase()}.png`} alt={country+" flag"}/>:null}<span>{neutral?"INDIVIDUAL NEUTRAL ATHLETE":player.countryCode||"COUNTRY UNAVAILABLE"}</span></div>
    <div className="tp-player-points"><span>RANKING POINTS</span><b>{player.rankingPoints==null?"—":Number(player.rankingPoints).toLocaleString()}</b></div>
    <a className="tp-open-profile" href={player.profileUrl} target="_blank" rel="noopener noreferrer" aria-label={"Open permanent FBIS profile for "+player.name}>PLAYER INTELLIGENCE <span aria-hidden="true">↗</span></a>
  </div>
 </article>;
}
export default function TennisPlayersView({refreshKey=0}){
 const initial=()=>{if(typeof window==="undefined")return"wta";return new URLSearchParams(window.location.search).get("tour")==="atp"?"atp":"wta"};
 const [tour,setTour]=useState(initial),[search,setSearch]=useState(""),[scope,setScope]=useState("all"),[page,setPage]=useState(1);
 const [result,setResult]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const trimmed=search.trim();
 useEffect(()=>{const ac=new AbortController();const timeout=setTimeout(()=>{
   const p=new URLSearchParams({tour,page:String(page),scope});if(trimmed)p.set("q",trimmed);
   setLoading(true);setError("");
   fetch("/api/tennis-players?"+p,{signal:ac.signal}).then(async r=>{const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||"Player directory unavailable");return d})
     .then(d=>{if(!ac.signal.aborted)setResult(d)}).catch(e=>{if(e.name!=="AbortError"&&!ac.signal.aborted)setError(e.message)})
     .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  },trimmed?250:0);
  return()=>{ac.abort();clearTimeout(timeout)};
 },[tour,trimmed,scope,page,refreshKey]);
 const title=TOUR_BRANDS[tour];const players=result?.tour===tour?result.players||[]:[];
 const status=useMemo(()=>loading?"Loading players…":error||(`${result?.total??0} verified directory identities`),[loading,error,result?.total]);
 return <section className={`tp-page tp-${tour}`} aria-label="ATP and WTA permanent player cards">
   <div className="tp-hero"><div><span className="stp-eyebrow">FBIS TENNIS · CANONICAL PLAYER LIBRARY</span><h2>Player Intelligence</h2><p>Permanent ATP/WTA profiles, retained portraits and verified player identity. Player images stay linked to the canonical profile when match markets close.</p></div><Brand tour={tour}/></div>
   <div className="tp-toolbar">
     <div className="tp-tours" role="group" aria-label="Choose tennis tour">{["wta","atp"].map(t=><button key={t} className={tour===t?"active":""} type="button" aria-pressed={tour===t} onClick={()=>{setTour(t);setPage(1);setSearch("");setResult(null);if(typeof window!=="undefined"){const u=new URL(window.location.href);u.searchParams.set("directorySport","tennis");u.searchParams.set("tour",t);window.history.replaceState({},"",u)}}}><Brand tour={t} small/>{TOUR_BRANDS[t].label} PLAYERS</button>)}</div>
     <label className="tp-search">Find player<input type="search" value={search} placeholder={tour==="wta"?"Search WTA players…":"Search ATP players…"} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label>
     <label className="tp-scope">Roster<select aria-label="Player roster scope" value={scope} onChange={e=>{setScope(e.target.value);setPage(1)}}><option value="all">All indexed players</option><option value="ranked">Players with stored rankings</option></select></label>
   </div>
   <div className="tp-directory-bar"><div><Brand tour={tour} small/><strong>{title.title} · Player Cards</strong></div><span role="status">{status}</span></div>
   {error?<p className="tp-error" role="alert">{error}</p>:null}
   {!error&&loading&&!result?<p className="tp-empty" role="status">Loading permanent player profiles…</p>:null}
   {!error&&!loading&&players.length===0?<p className="tp-empty">No indexed players match these filters. ATP ranking coverage is not yet authoritative.</p>:null}
   <div className="tp-player-grid">{players.map(p=><PlayerCard key={p.playerId} player={p}/>)}</div>
   {result?.pages>1?<nav className="tp-pagination" aria-label="Tennis player directory pages"><button disabled={page<=1||loading} onClick={()=>setPage(p=>Math.max(1,p-1))}>← Previous</button><span>Page {page} of {result.pages}</span><button disabled={page>=result.pages||loading} onClick={()=>setPage(p=>p+1)}>Next →</button></nav>:null}
   <p className="tp-provenance">FBIS player records are sourced and timestamped; missing rankings and portraits are not invented. ATP and WTA trademarks identify their respective tours only and do not imply partnership or endorsement. External photo URLs remain provider-owned; approved images are retained in the FBIS archive.</p>
 </section>;
}
