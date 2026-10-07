import { useState } from "react";
import AdvancedGameDetail from "./AdvancedGameDetail.jsx";
import "./tennisMatchCard.css";

const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const pct=v=>n(v)==null?"—":`${(n(v)*100).toFixed(1)}%`;
const probPct=v=>n(v)==null?"—":`${n(v).toFixed(1)}%`;
const odds=v=>{const x=n(v);if(x==null)return"—";const q=Math.round(x);return q>0?`+${q}`:String(q)};
const line=v=>{const x=n(v);if(x==null)return"—";return x>0?`+${x}`:String(x)};
const fair=p=>{const x=n(p);if(x==null||x<=0||x>=1)return"—";const a=x>=.5?-100*x/(1-x):100*(1-x)/x;return odds(a)};
const playerMeta=(p,tour)=>{const r=n(p?.rank),pts=n(p?.rankingPoints);return [r!=null?`${tour} #${Math.round(r)}`:`${tour} RANK —`,pts!=null?`${Math.round(pts).toLocaleString()} points`:"POINTS —"].join("  |  ")};
const COUNTRY_COLORS=Object.freeze({US:"#234f9b",GB:"#17365d",ES:"#aa151b",FR:"#244aa5",IT:"#167a45",DE:"#343434",AU:"#145a32",CA:"#b31b34",CN:"#b7192f",JP:"#8b2331",KR:"#1f4e79",RS:"#8a1538",HR:"#174a8b",PL:"#b31b34",CZ:"#174a8b",AR:"#3f7cac",BR:"#1e6b3a",CH:"#b31b34",NL:"#d05a1f",BE:"#222f5b",AT:"#9a1e2e",GR:"#28528a"});
const countryColor=(code)=>COUNTRY_COLORS[String(code||"").trim().toUpperCase()]||"#12304a";
const formRecord=(p)=>{const xs=recent(p).slice(0,5).map(x=>String(x?.result||"").toUpperCase()).filter(x=>x==="W"||x==="L");return xs.length?`${xs.filter(x=>x==="W").length}–${xs.filter(x=>x==="L").length}`:null};
const venueRows=(offers=[])=>{const by=new Map();for(const o of offers||[]){const source=String(o.source||"").toUpperCase();if(!source)continue;if(!by.has(source))by.set(source,{source,ml:{},spread:{},total:{}});const r=by.get(source),m=String(o.marketFamily||"");if(m==="moneyline")r.ml[o.side]=o;if(m==="spread")r.spread[o.side]=o;if(m==="total")r.total[o.side]=o;}return [...by.values()]};
const offerText=o=>!o?"—":[o.line==null?null:line(o.line),o.americanOdds==null?null:odds(o.americanOdds)].filter(Boolean).join(" ")||"—";
const splitRow=(market,side,row)=>row?<tr><td>{market}</td><td>{side||"—"}</td><td>{row.ticketPct==null?"—":`${Math.round(row.ticketPct)}%`}</td><td>{row.moneyPct==null?"—":`${Math.round(row.moneyPct)}%`}</td><td className={Number(row.moneyTicketGap)>=0?"tmc-good":"tmc-bad"}>{row.moneyTicketGap==null?"—":`${Number(row.moneyTicketGap)>0?"+":""}${Math.round(row.moneyTicketGap)}%`}</td></tr>:null;

export default function TennisMatchCard({game,open=false,onToggle,renderDetail=null}){
  const away=game?.away||{},home=game?.home||{},t=game?.tennisProjection||{},ref=game?.market?.reference||{},intel=game?.actionIntel||{};
  const tour=String(game?.tour||t?.tour||"TENNIS").toUpperCase();
  const pAway=n(t.player2WinProb),pHome=n(t.player1WinProb),mHome=n(t.marketPriorP1??ref?.noVig?.home),mAway=n(t.marketPriorP2??ref?.noVig?.away);
  const edgeHome=pHome!=null&&mHome!=null?(pHome-mHome)*100:null,edgeAway=pAway!=null&&mAway!=null?(pAway-mAway)*100:null;
  const candidates=[{p:home,e:edgeHome},{p:away,e:edgeAway}].filter(x=>Number.isFinite(x.e)&&x.e>0);
  const best=candidates.sort((a,b)=>b.e-a.e)[0]||null;
  const spread=ref?.spread||{},total=ref?.total||{},ml=ref?.moneyline||{};
  const venueOffers=Array.isArray(t.venueOffers)?t.venueOffers:Array.isArray(ref.venueOffers)?ref.venueOffers:[];
  const venues=venueRows(venueOffers);
  const markets=Array.isArray(intel?.publicSplits?.markets)?intel.publicSplits.markets:[];
  const spIntel=markets.find(x=>String(x.market).toUpperCase()==="SPREAD");
  const totIntel=markets.find(x=>String(x.market).toUpperCase()==="TOTAL");
  const mlIntel=intel?.publicSplits&&(intel.publicSplits.ticketPct!=null||intel.publicSplits.moneyPct!=null)?intel.publicSplits:null;
  const cardKey=`tennis:${game?.id||""}`;
  const surface=[t.surface?String(t.surface).toUpperCase():null,t.indoor===true?"INDOOR":t.indoor===false?"OUTDOOR":null].filter(Boolean).join(" · ");
  const when=game?.start?new Date(game.start):null;
  const time=when&&Number.isFinite(when.getTime())?when.toLocaleString("en-US",{timeZone:"America/Chicago",weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true}):"—";
  const status=game?.publicationStatus||"RESEARCH";
  const bank=t?.playerBank||{}, bp1=bank.players?.[0]||{}, bp2=bank.players?.[1]||{}, h2h=bank.headToHead||{};
  const recent=(p)=>(p?.recentForm||[]);
  const formTokens=(p)=>recent(p).length?recent(p).slice(0,5).map((x,i)=>{const r=String(x?.result||"").toUpperCase();return <span key={i} className={r==="W"?"tmc-form-win":r==="L"?"tmc-form-loss":"tmc-form-unknown"}>{r||"—"}</span>}):<span className="tmc-form-unknown">—</span>;
  const portraitUrl=(team,bp)=>team?.headshotUrl||team?.headshot_url||team?.photoUrl||team?.photo_url||bp?.headshotUrl||bp?.headshot_url||null;
  const country=(team,bp)=>String(team?.countryCode||team?.country_code||team?.country||bp?.countryCode||bp?.country_code||bp?.country||"").trim();
  const flagUrl=(code)=>{const cc=String(code||"").trim().toLowerCase();return /^[a-z]{2}$/.test(cc)?`https://flagcdn.com/w80/${cc}.png`:null};
  const flagFallback=(code)=>{const cc=String(code||"").trim().toUpperCase();if(!/^[A-Z]{2}$/.test(cc))return "";return String.fromCodePoint(...[...cc].map(ch=>127397+ch.charCodeAt(0)))};
  const PlayerVisual=({team,bp})=>{const [failed,setFailed]=useState(false),src=portraitUrl(team,bp),cc=country(team,bp),flag=flagUrl(cc);return <div className="tmc-player-visual" style={{"--tmc-country":countryColor(cc),"--tmc-flag":flag?`url("${flag}")`:"none"}}>{src&&!failed?<img className="tmc-headshot" src={src} alt={`${team?.fullName||team?.name||"Tennis player"} headshot`} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:<div className="tmc-headshot-fallback" aria-label="Player headshot unavailable"><span aria-hidden="true">♙</span></div>}<span className="tmc-country" title={cc||"Country unavailable"}>{flag?<img src={flag} alt={`${cc} flag`}/>:flagFallback(cc)||"—"}</span></div>};
  return <article className="tmc">
    <header className="tmc-top"><div><b>TENNIS</b><strong>{t.tournament||tour}</strong><span>{tour}</span><span>{surface||"SURFACE —"}</span></div><div><span>{time} CT</span><em>{status.includes("RESEARCH")?"RESEARCH":status}</em></div></header>
    <section className="tmc-hero">
      <div className="tmc-player-side" style={{"--tmc-country":countryColor(country(away,bp2)),"--tmc-flag":flagUrl(country(away,bp2))?`url("${flagUrl(country(away,bp2))}")`:"none"}}>
        <PlayerVisual team={away} bp={bp2}/><div className="tmc-player-copy"><h2>{away.fullName||away.name||"Player unavailable"}</h2><p>{playerMeta(away,tour)}</p><strong>{pct(pAway)}</strong><small>FBIS WIN PROBABILITY</small><b>{fair(pAway)}<i>FBIS FAIR ML</i></b></div>
      </div>
      <div className="tmc-vs">VS</div>
      <div className="tmc-player-side tmc-home" style={{"--tmc-country":countryColor(country(home,bp1)),"--tmc-flag":flagUrl(country(home,bp1))?`url("${flagUrl(country(home,bp1))}")`:"none"}}>
        <PlayerVisual team={home} bp={bp1}/><div className="tmc-player-copy"><h2>{home.fullName||home.name||"Player unavailable"}</h2><p>{playerMeta(home,tour)}</p><strong>{pct(pHome)}</strong><small>FBIS WIN PROBABILITY</small><b>{fair(pHome)}<i>FBIS FAIR ML</i></b></div>
      </div>
      <aside className="tmc-edge"><span>MODEL vs MARKET</span><b>{best?.p?.fullName||best?.p?.name||"NO EDGE"}</b><strong>{best?`+${Math.abs(best.e).toFixed(1)}%`:"—"}</strong><small>WIN PROBABILITY EDGE</small><small className="tmc-edge-help">FBIS win probability minus market no-vig probability</small><em>RESEARCH</em></aside>
    </section>
    <div className="tmc-main">
      <section className="tmc-panel tmc-odds"><h3>MARKET ODDS</h3><table><thead><tr><th></th><th>MONEYLINE</th><th>GAME SPREAD</th><th>TOTAL GAMES</th></tr></thead><tbody>
        <tr><td>{away.fullName||away.name}</td><td>{odds(ml.away)}</td><td>{spread.away==null?"—":`${line(spread.away)} (${odds(spread.awayPrice)})`}</td><td>{total.line==null?"—":`O ${total.line} (${odds(total.overPrice)})`}</td></tr>
        <tr><td>{home.fullName||home.name}</td><td>{odds(ml.home)}</td><td>{spread.home==null?"—":`${line(spread.home)} (${odds(spread.homePrice)})`}</td><td>{total.line==null?"—":`U ${total.line} (${odds(total.underPrice)})`}</td></tr>
        <tr className="tmc-market"><td>MARKET NO-VIG</td><td>{mAway==null?"—":pct(mAway)} / {mHome==null?"—":pct(mHome)}</td><td colSpan="2">Market benchmark</td></tr>
        <tr className="tmc-fbis"><td>FBIS WIN PROB</td><td>{pct(pAway)} / {pct(pHome)}</td><td colSpan="2">Independent model</td></tr>
        <tr><td>EDGE (VS NO-VIG)</td><td className={edgeHome>=0?"tmc-good":"tmc-bad"}>{edgeAway==null?"—":`${edgeAway>0?"+":""}${edgeAway.toFixed(1)}%`} / {edgeHome==null?"—":`${edgeHome>0?"+":""}${edgeHome.toFixed(1)}%`}</td><td colSpan="2">Research only</td></tr>
      </tbody></table></section>
      {venues.length?<section className="tmc-panel tmc-venues"><h3>MULTI-VENUE MARKET</h3><table><thead><tr><th>VENUE</th><th>ML</th><th>SPREAD</th><th>TOTAL</th></tr></thead><tbody>{venues.map(v=><tr key={v.source}><td>{v.source}</td><td>{offerText(v.ml.away)} / {offerText(v.ml.home)}</td><td>{offerText(v.spread.away)} / {offerText(v.spread.home)}</td><td>{offerText(v.total.over)} / {offerText(v.total.under)}</td></tr>)}</tbody></table><small>Observed venue offers · informational only · FBIS projection remains independent</small></section>:null}
      <aside className="tmc-panel tmc-info"><h3>MATCH INFO</h3><dl><dt>Tournament</dt><dd>{t.tournament||"—"}</dd><dt>Tour</dt><dd>{tour}</dd><dt>Surface</dt><dd>{surface||"—"}</dd><dt>Court Speed</dt><dd>{t.courtSpeedIndex??"—"}</dd><dt>Market Source</dt><dd>{t.marketProvider||ref.provider||"—"}</dd><dt>Sportsbook</dt><dd>{t.sportsbook||"Consensus"}</dd></dl></aside>
    </div>
    <div className="tmc-lower">
      <section className="tmc-panel tmc-action"><h3>ACTION MARKET INTELLIGENCE <span>ACTION ●</span></h3><table><thead><tr><th>MARKET</th><th>SIDE</th><th>TICKETS</th><th>MONEY</th><th>GAP</th></tr></thead><tbody>
        {splitRow("Moneyline",best?.p?.fullName||best?.p?.name,mlIntel)}
        {splitRow("Spread",spread.home!=null?`${home.abbr} ${line(spread.home)}`:"—",spIntel)}
        {splitRow("Total",total.line!=null?`O/U ${total.line}`:"—",totIntel)}
        {!mlIntel&&!spIntel&&!totIntel?<tr><td colSpan="5">NO ACTION SNAPSHOT</td></tr>:null}
      </tbody></table></section>
      <section className="tmc-panel tmc-context"><h3>MATCH CONTEXT</h3><div><span>Surface</span><b>{surface||"—"}</b></div><div><span>Player rankings</span><b>{away.rank?"#"+away.rank:"—"} vs {home.rank?"#"+home.rank:"—"}</b></div><div><span>Market updated</span><b>{ref.observedAt?new Date(ref.observedAt).toLocaleTimeString("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"2-digit"}):"—"}</b></div><div><span>Model</span><b>{game?.model?.name||game?.modelId||"Tennis-FBIS-v2"}</b></div></section>
    </div>
    <div className="tmc-deep">
      <section className="tmc-panel"><h3>RECENT FORM (LAST 5)</h3><div className="tmc-form"><div><b>{home.fullName||home.name||"Player unavailable"}</b>{recent(bp1).length?<div className="tmc-form-line"><strong className="tmc-form-results">{formTokens(bp1)}</strong><em>{formRecord(bp1)}</em></div>:<span className="tmc-form-unavailable">Recent form unavailable</span>}<span>Hold {bp1.holdPct==null?"—":pct(bp1.holdPct)} · Break {bp1.breakPct==null?"—":pct(bp1.breakPct)}</span></div><div><b>{away.fullName||away.name||"Player unavailable"}</b>{recent(bp2).length?<div className="tmc-form-line"><strong className="tmc-form-results">{formTokens(bp2)}</strong><em>{formRecord(bp2)}</em></div>:<span className="tmc-form-unavailable">Recent form unavailable</span>}<span>Hold {bp2.holdPct==null?"—":pct(bp2.holdPct)} · Break {bp2.breakPct==null?"—":pct(bp2.breakPct)}</span></div></div></section>
      <section className="tmc-panel"><h3>HEAD TO HEAD</h3><div className="tmc-h2h"><strong>{h2h.meetings||0} meetings</strong><span>{home.fullName||home.name} {h2h.player1Wins||0}–{h2h.player2Wins||0} {away.fullName||away.name}</span>{h2h.recent?.[0]?<small>Latest: {h2h.recent[0].winner} · {h2h.recent[0].score||"score unavailable"}</small>:<small>No previous meeting in player bank</small>}</div></section>
      <section className="tmc-panel"><h3>FBIS PROJECTED MATCH</h3><div className="tmc-projected"><div><span>Win probability</span><b>{pct(pHome)} / {pct(pAway)}</b></div><div><span>Fair moneyline</span><b>{fair(pHome)} / {fair(pAway)}</b></div><div><span>Total games</span><b>{t.projectedTotalGames??"—"}</b></div><div><span>Game spread</span><b>{t.projectedGameSpread??"—"}</b></div></div></section>
    </div>
    <footer className="tmc-footer"><span>FBIS TENNIS · MARKET INTELLIGENCE · {status}</span>{typeof onToggle==="function"?<button onClick={()=>onToggle(cardKey)}>{open?"Hide Details":"View Details"} →</button>:null}</footer>
    {open?<div className="tmc-advanced"><AdvancedGameDetail game={game} onClose={()=>onToggle?.(cardKey)}/>{typeof renderDetail==="function"?renderDetail(game):null}</div>:null}
  </article>;
}
