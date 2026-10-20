import { useState } from "react";
import AdvancedGameDetail from "./AdvancedGameDetail.jsx";
import "./tennisMatchCard.css";
import { tennisProjectionDisplay, splitTennisName, neutralTennisAthlete } from "../../lib/tennisCardPresentation.js";

const n=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const pct=v=>n(v)==null?"—":`${(n(v)*100).toFixed(1)}%`;
const probPct=v=>n(v)==null?"—":`${n(v).toFixed(1)}%`;
const odds=v=>{const x=n(v);if(x==null)return"—";const q=Math.round(x);return q>0?`+${q}`:String(q)};
const line=v=>{const x=n(v);if(x==null)return"—";return x>0?`+${x}`:String(x)};
const fair=p=>{const x=n(p);if(x==null||x<=0||x>=1)return"—";const a=x>=.5?-100*x/(1-x):100*(1-x)/x;return odds(a)};
const playerMeta=(p,tour)=>{const r=n(p?.rank),pts=n(p?.rankingPoints);return [r!=null&&r>0?`${tour} #${Math.round(r)}`:`${tour} RANK —`,pts!=null?`${Math.round(pts).toLocaleString()} points`:"POINTS —"].join("  |  ")};
const COUNTRY_COLORS=Object.freeze({US:"#234f9b",GB:"#17365d",ES:"#aa151b",FR:"#244aa5",IT:"#167a45",DE:"#343434",AU:"#145a32",CA:"#b31b34",CN:"#b7192f",JP:"#8b2331",KR:"#1f4e79",RS:"#8a1538",HR:"#174a8b",PL:"#b31b34",CZ:"#174a8b",AR:"#3f7cac",BR:"#1e6b3a",CH:"#b31b34",NL:"#d05a1f",BE:"#222f5b",AT:"#9a1e2e",GR:"#28528a"});
const countryColor=(code)=>COUNTRY_COLORS[String(code||"").trim().toUpperCase()]||"#12304a";
const offerText=o=>!o?"—":[o.line==null?null:line(o.line),o.contractPrice!=null?`${(o.contractPrice*100).toFixed(1)}¢`:o.decimalOdds!=null?`${o.decimalOdds.toFixed(3)} dec`:o.americanOdds==null?null:odds(o.americanOdds)].filter(Boolean).join(" ")||"—";
const splitRow=(market,side,row)=>row?<tr><td>{market}</td><td>{side||"—"}</td><td>{row.ticketPct==null?"—":`${Math.round(row.ticketPct)}%`}</td><td>{row.moneyPct==null?"—":`${Math.round(row.moneyPct)}%`}</td><td className={Number(row.moneyTicketGap)>=0?"tmc-good":"tmc-bad"}>{row.moneyTicketGap==null?"—":`${Number(row.moneyTicketGap)>0?"+":""}${Math.round(row.moneyTicketGap)}%`}</td></tr>:null;

const COUNTRY_CODES={POL:"PL",USA:"US",GBR:"GB",ESP:"ES",FRA:"FR",ITA:"IT",GER:"DE",DEU:"DE",AUS:"AU",CAN:"CA",CHN:"CN",JPN:"JP",KOR:"KR",SRB:"RS",CRO:"HR",HRV:"HR",CZE:"CZ",ARG:"AR",BRA:"BR",SUI:"CH",CHE:"CH",NED:"NL",NLD:"NL",BEL:"BE",AUT:"AT",GRE:"GR",GRC:"GR",UKR:"UA",ROU:"RO",RUS:"RU",BLR:"BY",KAZ:"KZ",DEN:"DK",DNK:"DK",NOR:"NO",SWE:"SE",FIN:"FI",LAT:"LV",LVA:"LV",EST:"EE",LTU:"LT",SVK:"SK",SLO:"SI",SVN:"SI",HUN:"HU",POR:"PT",PRT:"PT",TUR:"TR",RSA:"ZA",ZAF:"ZA",IND:"IN",TPE:"TW",TWN:"TW",HKG:"HK",MEX:"MX",COL:"CO",CHI:"CL",CHL:"CL",ECU:"EC",PER:"PE",URU:"UY",URY:"UY",ISR:"IL",EGY:"EG",NZL:"NZ",THA:"TH",IDN:"ID",PHI:"PH",PHL:"PH",VIE:"VN",VNM:"VN",UZB:"UZ",GEO:"GE",ARM:"AM",AZE:"AZ",BUL:"BG",BGR:"BG",BIH:"BA",MNE:"ME",LUX:"LU",IRL:"IE",CYP:"CY",MLT:"MT"};
const countryCode=v=>COUNTRY_CODES[String(v).toUpperCase()]||String(v).toUpperCase();
  const portraitUrl=(team,bp)=>team?.headshotUrl||team?.headshot_url||bp?.headshotUrl||bp?.headshot||null;
  const country=(team,bp)=>countryCode(String(team?.countryCode||team?.country_code||team?.country||bp?.countryCode||bp?.country_code||bp?.country||"").trim());
  const flagUrl=(code)=>{const cc=String(code||"").trim().toLowerCase();return /^[a-z]{2}$/.test(cc)?`https://flagcdn.com/w80/${cc}.png`:null};
  const flagFallback=(code)=>{const cc=String(code||"").trim().toUpperCase();if(!/^[A-Z]{2}$/.test(cc))return "";return String.fromCodePoint(...[...cc].map(ch=>127397+ch.charCodeAt(0)))};
  const PlayerVisual=({team,bp})=>{const [failed,setFailed]=useState(false),src=portraitUrl(team,bp),cc=country(team,bp),flag=neutralTennisAthlete(cc,team)?null:flagUrl(cc);return <div className="tmc-player-visual" style={{"--tmc-country":countryColor(cc)}}>{src&&!failed?<img className="tmc-headshot tmc-portrait-asset" src={src} alt={`${team?.fullName||team?.name||"Tennis player"} headshot`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<div className="tmc-headshot-fallback" aria-label="Player headshot unavailable"><svg viewBox="0 0 100 120" role="img" aria-label="Neutral player silhouette"><circle cx="50" cy="34" r="22" fill="currentColor"/><path d="M8 116v-18c0-25 19-40 42-40s42 15 42 40v18z" fill="currentColor"/></svg></div>}</div>};

export default function TennisMatchCard({game,open=false,onToggle,renderDetail=null}){
  const away=game?.away||{},home=game?.home||{},t=game?.tennisProjection||{},ref=game?.market?.reference||{},intel=game?.actionIntel||{};
  if(t.eventIntegrity?.valid!==true && !(t.researchFixture?.verified===true && t.researchFixture?.source==="ESPN_PUBLIC" && t.researchFixture?.fixtureId===game?.id))return <article className="tmc" role="status">Tennis card withheld: event identity or projection provenance is unverified.</article>;
  const tour=String(game?.tour||t?.tour||"TENNIS").toUpperCase();
  const display=tennisProjectionDisplay(game),{pAway,pHome,edgeHome,edgeAway}=display;
  // Research estimates are visually useful but remain separate from the
  // independently governed full FBIS projection and market-edge calculation.
  const research=t.researchFixture&&!display.valid?t.researchEstimate:null;
  const researchOk=research&&Number.isFinite(research.player1WinProb)&&
    Number.isFinite(research.player2WinProb)&&research.player1WinProb>0&&
    research.player2WinProb>0&&
    Math.abs(research.player1WinProb+research.player2WinProb-1)<0.002;
  const shownHome=display.valid?pHome:researchOk?research.player1WinProb:null;
  const shownAway=display.valid?pAway:researchOk?research.player2WinProb:null;
  const shownLabel=display.valid?"FBIS WIN PROBABILITY":researchOk?"HISTORICAL ELO ESTIMATE":"WIN PROBABILITY UNAVAILABLE";
  const mHome=n(ref?.noVig?.home),mAway=n(ref?.noVig?.away);
  const candidates=[{p:home,e:edgeHome},{p:away,e:edgeAway}].filter(x=>Number.isFinite(x.e)&&x.e>0);
  const best=candidates.sort((a,b)=>b.e-a.e)[0]||null;
  const gapPlayer = display.valid && best ? best.p : null;
  const gapPlayerCountry = gapPlayer ? country(gapPlayer, gapPlayer === home ? t?.playerBank?.players?.[0] : t?.playerBank?.players?.[1]) : null;
  const gapPlayerNeutral = gapPlayer ? neutralTennisAthlete(gapPlayerCountry,gapPlayer) : false;
  const gapPlayerFlag = gapPlayer && !gapPlayerNeutral ? flagUrl(gapPlayerCountry) : null;
  const gapPlayerTint = gapPlayer && gapPlayerCountry && !gapPlayerNeutral ? countryColor(gapPlayerCountry) : null;

  const spread=ref?.spreadDetail||(typeof ref?.spread==="object"?ref.spread:{} )||{},total=ref?.totalDetail||(typeof ref?.total==="object"?ref.total:{} )||{},ml=ref?.moneyline||{};
  const venueOffers=Array.isArray(t.venueOffers)?t.venueOffers:Array.isArray(ref.venueOffers)?ref.venueOffers:[];
  const markets=Array.isArray(intel?.publicSplits?.markets)?intel.publicSplits.markets:[];
  const spIntel=markets.find(x=>String(x.market).toUpperCase()==="SPREAD");
  const totIntel=markets.find(x=>String(x.market).toUpperCase()==="TOTAL");
  const mlIntel=intel?.publicSplits&&(intel.publicSplits.ticketPct!=null||intel.publicSplits.moneyPct!=null)?intel.publicSplits:null;
  const cardKey=`tennis:${game?.id||""}`;
  const surface=[t.surface?String(t.surface).toUpperCase():null,t.indoor===true?"INDOOR":t.indoor===false?"OUTDOOR":null].filter(Boolean).join(" · ");
  const when=game?.start?new Date(game.start):null;
  const time=when&&Number.isFinite(when.getTime())?when.toLocaleString("en-US",{timeZone:"America/Chicago",weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:true}):"—";
  const status=game?.publicationStatus||"RESEARCH";
  const statusLabel=t.researchFixture?"RESEARCH FIXTURE":display.valid?"RESEARCH PROJECTION":"PROJECTION BLOCKED";
  const hasObservedMarket=Boolean(venueOffers.some(o=>o.source&&o.collectedAt)||ref.observedAt||t.marketObservedAt);
  const researchOnly=Boolean(t.researchFixture);
  const winnerName=display.valid?(display.winner?.fullName||display.winner?.name||"Model tie"):null;
  const bank=t?.playerBank||{}, bp1=bank.players?.[0]||{}, bp2=bank.players?.[1]||{}, h2h=bank.headToHead||{};
  const recent=(p)=>(p?.recentForm||[]);
  const formRecord=(p)=>{const xs=recent(p).slice(0,5).map(x=>String(x?.result||"").toUpperCase()).filter(x=>x==="W"||x==="L");return xs.length?`${xs.filter(x=>x==="W").length}–${xs.filter(x=>x==="L").length}`:null};
  const formTokens=(p)=>recent(p).length?recent(p).slice(0,5).map((x,i)=>{const r=String(x?.result||"").toUpperCase();return <span key={i} className={r==="W"?"tmc-form-win":r==="L"?"tmc-form-loss":"tmc-form-unknown"}>{r||"—"}</span>}):<span className="tmc-form-unknown">—</span>;
  const theme=t.indoor===true?"indoor":["hard","clay","grass"].includes(String(t.surface).toLowerCase())?String(t.surface).toLowerCase():"unknown";
  const identity=(team,bp)=>{const name=splitTennisName(team.fullName||team.name),cc=country(team,bp),neutral=neutralTennisAthlete(cc,team),flag=neutral?null:flagUrl(cc);return <div className="tmc-player-copy"><h2><span>{name.first}</span><strong>{name.last}</strong></h2><div className="tmc-nationality">{flag?<img className="tmc-primary-flag" src={flag} alt={`${cc} flag`} loading="lazy"/>:neutral?<span className="tmc-neutral-mark" aria-label="Individual neutral athlete">AIN</span>:<span className="tmc-neutral-mark">{flagFallback(cc)||"—"}</span>}{neutral?"INDIVIDUAL NEUTRAL ATHLETE":cc||"NATIONALITY UNAVAILABLE"}</div><p className="tmc-rank">{playerMeta(team,tour).split("  |  ")[0]}</p><p className="tmc-points">{playerMeta(team,tour).split("  |  ")[1]}</p>{bp.surfaceElo!=null?<small>Surface Elo {Math.round(bp.surfaceElo)}</small>:bp.elo!=null?<small>Elo {Math.round(bp.elo)}</small>:null}{team.canonicalId||team.fbisPlayerId?<a className="tmc-profile-link" href={`/api/tennis-player-profile?id=${encodeURIComponent(team.canonicalId||team.fbisPlayerId)}`} title={`Open permanent player profile for ${team.fullName||team.name}`}>PLAYER PROFILE ↗</a>:null}</div>};
  const sideStyle=(team,bp)=>({"--tmc-country":countryColor(country(team,bp))});
  const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}):"Unavailable";
  return <article className={`tmc tmc-compact tmc-surface-${theme}`} aria-label={`${away.fullName||away.name} versus ${home.fullName||home.name}`}>
    <header className="tmc-top"><div><b>{tour}</b><strong>{t.tournament||"Tournament unverified"}</strong>{t.tournamentLevel?<span>{t.tournamentLevel}</span>:null}{t.round?<span>{t.round}</span>:null}<span>{surface||"SURFACE UNVERIFIED"}</span></div><div><span>{time} CT</span><em>{statusLabel}</em></div></header>
    <section className="tmc-hero">
      <div className="tmc-player-side" style={sideStyle(away,bp2)}><PlayerVisual key={away.canonicalId||away.fbisPlayerId||away.name} team={away} bp={bp2}/>{identity(away,bp2)}</div>
      <div className="tmc-vs">VS</div>
      <div className="tmc-player-side tmc-home" style={sideStyle(home,bp1)}><PlayerVisual key={home.canonicalId||home.fbisPlayerId||home.name} team={home} bp={bp1}/>{identity(home,bp1)}</div>
    </section>
    <section className={`tmc-market-gap ${gapPlayer?"is-player":"is-neutral"}`} style={gapPlayerTint?{"--tmc-market-gap-color":gapPlayerTint}:undefined} aria-label="Tennis model versus market comparison">
      <span>FBIS / MARKET GAP</span>
      <div className="tmc-market-gap-identity">
        {gapPlayer ? <>
          {gapPlayerFlag ? <img src={gapPlayerFlag} alt={`${gapPlayerCountry} flag`} loading="lazy" /> : <span className="tmc-gap-neutral-player">{gapPlayerCountry||"PLAYER"}</span>}
          <b>{gapPlayer.fullName||gapPlayer.name||"PLAYER"}</b>
        </> : <b>NO COMPARABLE PRICE</b>}
      </div>
      <strong>{gapPlayer ? `+${best.e.toFixed(1)} pp` : "—"}</strong>
      <small>{gapPlayer?"MODEL VS NO-VIG · RESEARCH ONLY · NOT EV":"GAP NOT VERIFIED · NO WAGER AUTHORITY"}</small>
    </section>
    <section className="tmc-probability" aria-label={display.valid?"Verified FBIS model win probability":"Independent historical tennis research estimate"} aria-live="polite">
      <div><span>{shownLabel}</span><strong>{pct(shownAway)}</strong></div>
      <div className="tmc-probability-center">{shownHome!=null&&shownAway!=null?<><div className="tmc-probability-track" role="img" aria-label={`${away.name} ${pct(shownAway)}; ${home.name} ${pct(shownHome)}`}><span style={{width:`${shownAway*100}%`}}/><span style={{width:`${shownHome*100}%`}}/></div><div className="tmc-bar-labels"><b>{pct(shownAway)}</b><b>{pct(shownHome)}</b></div>{researchOk&&!display.valid?<small>RESEARCH ONLY · {research.surface?research.surface.toUpperCase()+" COURT":"SURFACE UNVERIFIED"} · Historical sample through {research.observations?.map(o=>o.lastMatchDate).filter(Boolean).sort().at(-1)||"date unavailable"} · Not the validated FBIS model or a betting edge</small>:null}</>:<p className="tmc-blocked">PROJECTION UNAVAILABLE · INSUFFICIENT HISTORICAL INPUTS · {display.reason}</p>}</div>
      <div><span>{shownLabel}</span><strong>{pct(shownHome)}</strong></div>
    </section>
    {t.researchFixture?<p className="tmc-fixture-note">Independent ESPN research fixture · {t.researchFixture.fixtureFreshness==="STALE"?"STATUS STALE · ":null}{t.researchFixture.officialDisplayEvidence?`WTA official match metadata linked (display only, observed ${t.researchFixture.officialDisplayEvidence.observedAt}) · No verified projection`:"Official schedule metadata unverified · No verified projection"} · ESPN observed {t.researchFixture.fetchedAt}</p>:null}
    {t.researchFixture?.missingEvidence?.length?<p className="tmc-fixture-note" role="status">MISSING VERIFIED DATA · {t.researchFixture.missingEvidence.join(" · ").replaceAll("_"," ")}</p>:null}
    {t.researchEstimate?<section className="tmc-fixture-note" aria-label="Independent surface Elo research estimate"><strong>{t.researchEstimate.surface?"SURFACE ELO ESTIMATE":"ALL-SURFACE ELO ESTIMATE"} · RESEARCH ONLY</strong> · {t.researchEstimate.surface?.toUpperCase()||"SURFACE UNKNOWN"} · {home.fullName||home.name}: {(t.researchEstimate.player1WinProb*100).toFixed(1)}% / {away.fullName||away.name}: {(t.researchEstimate.player2WinProb*100).toFixed(1)}% · Not an FBIS PURE projection or betting edge</section>:null}
    {t.researchFixture?<section className="tmc-fixture-note" aria-label="Tennis market and tournament context">
      <strong>TOURNAMENT CONTEXT</strong> · {t.tournament||t.polymarketGlobalOffers?.[0]?.question?.split(":")[0]||"Official event not linked"} · {t.surface||"Surface unverified"} · {t.round||"Round unverified"}
      {t.polymarketGlobalOffers?.length&&!t.tournament?<span> · Polymarket event label (research only)</span>:null}
    </section>:null}
    {t.researchFixture?<section className="tmc-fixture-note" aria-label="Independent Tennis exchange market research">
      <strong>MARKETS · POLYMARKET.COM {t.polymarketGlobalOffers?.length||0} · KALSHI {t.kalshiResearchOffers?.length||0}</strong>
      {t.exchangeResearch?.comparisons?.length?<>
        {t.exchangeResearch.comparisons.map(c=><div key={c.kalshiTicker+"-"+c.player}>
          {c.player}: Kalshi ask ${c.kalshiAsk.toFixed(3)} · Polymarket CLOB ask ${c.polymarketAsk.toFixed(3)} · Captures {c.observedKalshiAt||"time unknown"} / {c.observedPolymarketAt||"time unknown"}
        </div>)}
        <small>Indicative research comparison · contract fees, fillability, and wager eligibility unverified</small>
      </>:<div>No source-verified same-outcome cross-exchange pair. Expand for individual market observations.</div>}
    </section>:null}
    <div className="tmc-quick-summary" aria-label="FBIS projection summary">
      <span className="tmc-quick-model">FBIS PROJECTION · {display.valid?winnerName:"BLOCKED"}</span>
      <span className="tmc-quick-fair">FAIR MONEYLINE · {fair(pAway)} / {fair(pHome)}</span>
      <span className="tmc-quick-status">{display.valid?(game.projectionMaturity||"RESEARCH"):"NO VERIFIED PROJECTION"}</span>
    </div>
    {[away,home].some(p=>p.portraitSourceUrl&&p.portraitCredit)?<div className="tmc-photo-credits" aria-label="Player portrait credits">{[away,home].filter(p=>p.portraitSourceUrl&&p.portraitCredit).map(p=><span key={p.canonicalId||p.name}><a href={p.portraitSourceUrl} target="_blank" rel="noopener noreferrer" title={p.portraitCredit}>Photo: {p.fullName||p.name}</a>{p.portraitLicenseUrl?<a href={p.portraitLicenseUrl} target="_blank" rel="noopener noreferrer"> · License</a>:null}</span>)}</div>:null}
    {t.polymarketGlobalOffers?.length?<div className="tmc-fixture-note"><strong>POLYMARKET.COM · {t.polymarketGlobalOffers.length} SOURCE-MATCHED RESEARCH MARKET{t.polymarketGlobalOffers.length===1?"":"S"}</strong> · Expand Matchup Intelligence for prices, CLOB depth, and schedule verification.</div>:null}
    <details className="tmc-expand">
      <summary className="tmc-expand-toggle"><span className="tmc-expand-title">MATCHUP INTELLIGENCE</span><span className="tmc-expand-hint">{researchOnly?"Research fixture · Unverified event details · Form · Surfaces":"FBIS projection · Markets · Form · H2H · Surfaces"}</span><span className="tmc-expand-chevron" aria-hidden="true">⌄</span></summary>
      <div className="tmc-expanded-body">
    <div className="tmc-main">
      <section className="tmc-panel tmc-comparison"><h3>MODEL VS MARKET</h3><table><thead><tr><th></th><th>{away.name}</th><th>{home.name}</th></tr></thead><tbody><tr><td>FBIS FAIR ML</td><td className="tmc-good">{fair(pAway)}</td><td className="tmc-good">{fair(pHome)}</td></tr><tr><td>EDGE VS NO-VIG</td><td>{edgeAway==null?"—":`${edgeAway.toFixed(1)} pp`}</td><td>{edgeHome==null?"—":`${edgeHome.toFixed(1)} pp`}</td></tr></tbody></table><small>{display.marketReason||"Contemporaneous paired prices · research only"}</small></section>
      <section className="tmc-panel tmc-odds"><h3>MARKET ODDS</h3><table><thead><tr><th></th><th>MONEYLINE</th><th>GAME SPREAD</th><th>TOTAL GAMES</th></tr></thead><tbody>
        <tr><td>{away.fullName||away.name}</td><td>{odds(ml.away)}</td><td>{spread.away==null?"—":`${line(spread.away)} (${odds(spread.awayPrice)})`}</td><td>{total.line==null?"—":`O ${total.line} (${odds(total.overPrice)})`}</td></tr>
        <tr><td>{home.fullName||home.name}</td><td>{odds(ml.home)}</td><td>{spread.home==null?"—":`${line(spread.home)} (${odds(spread.homePrice)})`}</td><td>{total.line==null?"—":`U ${total.line} (${odds(total.underPrice)})`}</td></tr>
        <tr className="tmc-market"><td>MARKET NO-VIG</td><td>{mAway==null?"—":pct(mAway)} / {mHome==null?"—":pct(mHome)}</td><td colSpan="2">Market benchmark</td></tr>
      </tbody></table></section>
      <aside className="tmc-panel tmc-info"><h3>MATCH INFO</h3><dl><dt>Tournament</dt><dd>{t.tournament||"—"}</dd><dt>Tour</dt><dd>{tour}</dd><dt>Venue</dt><dd>{t.venue||"—"}</dd><dt>Round</dt><dd>{t.round||"—"}</dd><dt>Status</dt><dd>{researchOnly?`ESPN ${typeof game.status==="string"?game.status:game.status?.detail||"research fixture"}`:typeof game.status==="string"?game.status:game.status?.detail||"Unverified"}</dd><dt>Market time</dt><dd>{stamp(t.marketObservedAt||ref.observedAt)}</dd><dt>Surface</dt><dd>{surface||"—"}</dd><dt>Court Speed</dt><dd>{t.courtSpeedIndex??"—"}</dd><dt>Market Source</dt><dd>{hasObservedMarket?(t.marketProvider||ref.provider||venueOffers[0]?.source||"Observed venue"):"No matched market observations"}</dd><dt>Sportsbook</dt><dd>{hasObservedMarket?t.sportsbook||"Not established":"Not established"}</dd></dl></aside>
      <section className="tmc-panel tmc-projection-panel"><h3>FBIS PROJECTION</h3><div className="tmc-projected"><div><span>Win probability · {away.name} / {home.name}</span><b>{pct(pAway)} / {pct(pHome)}</b></div><div><span>Fair moneyline · {away.name} / {home.name}</span><b>{fair(pAway)} / {fair(pHome)}</b></div><div><span>Projected winner</span><b>{display.winner?.fullName||display.winner?.name||(display.valid?"Even projection":"Blocked")}</b></div><div><span>Projected total games</span><b>{display.valid&&n(t.projectedTotalGames)!=null?n(t.projectedTotalGames).toFixed(1):display.valid?"Not modeled":"—"}</b></div><div><span>Projected game spread</span><b>{display.valid?t.projectedGameSpread??"Not modeled":"—"}</b></div><div><span>Status</span><b>{display.freshness} · {game.projectionMaturity||"RESEARCH"}</b></div></div>{!display.valid?<p className="tmc-blocked">{display.reason}</p>:null}<small>{t.modelId||game.model?.name||game.modelId||"FBIS model unavailable"} · {display.version||"Version unavailable"}<br/>Created {stamp(display.createdAt)} · Wager eligibility unchanged<br/>Input history through {t.profileCutoffs?.length?t.profileCutoffs.map(p=>p.lastMatchDate||"unavailable").join(" / "):"unavailable"}</small></section>
    </div>
    {t.researchFixture && !t.polymarketGlobalOffers?.length?<p className="tmc-fixture-note">POLYMARKET.COM · {t.polymarketGlobalStatus==="FRESH_SNAPSHOT"?"NO VERIFIED MATCHED GAMMA CONTRACT":"SOURCE "+(t.polymarketGlobalStatus||"UNAVAILABLE")}</p>:null}
    {t.polymarketGlobalOffers?.length?<section className="tmc-panel" aria-label="Polymarket global research markets"><h3>POLYMARKET.COM · MATCH RESEARCH</h3><p>Independent international Gamma source; indicative probabilities are separate from captured CLOB asks. Market depth and fillability can change; no verified execution or FBIS betting authority.</p><table><thead><tr><th>MARKET</th><th>OUTCOMES</th><th>INDICATIVE PROBABILITY</th><th>CLOB ASK (CAPTURED)</th></tr></thead><tbody>{t.polymarketGlobalOffers.map(o=><tr key={o.marketId}><td><a href={"https://polymarket.com/sports/"+String(game.tour||"atp").toLowerCase()+"/"+o.eventSlug} target="_blank" rel="noreferrer">{o.question}</a>{o.scheduleStatus!=="START_WITHIN_TWO_HOURS"?<p>⚠ Schedule verification: {o.scheduleStatus==="PROVIDER_START_DIFFERS"?"provider start differs from FBIS": "provider date only; exact start unverified"}</p>:null}</td><td>{o.outcomes.join(" / ")}</td><td>{o.indicativePrices.map(v=>(v*100).toFixed(1)+"%").join(" / ")}</td><td>{o.researchClob?.sides?.map(x=>x.bestAsk?"$"+x.bestAsk.price.toFixed(2)+" · "+x.bestAsk.size+" contracts":"—").join(" / ")||"Unverified"}</td></tr>)}</tbody></table></section>:null}
    {t.kalshiResearchOffers?.length?<section className="tmc-panel" aria-label="Kalshi source-matched research offers"><h3>KALSHI · RESEARCH MATCH OBSERVATIONS</h3><p>Paired-player and event-clock research match only. Public indicative market level; not a verified fillable price, no fees or wager authority.</p><table><thead><tr><th>CONTRACT</th><th>YES OUTCOME</th><th>INDICATIVE ASK</th><th>FETCHED</th></tr></thead><tbody>{t.kalshiResearchOffers.map(o=><tr key={o.ticker}><td>{o.ticker}</td><td>{o.yesLabel||"Unverified"}</td><td>{o.yesAskDollars==null?"Unavailable":"$"+Number(o.yesAskDollars).toFixed(2)}</td><td>{o.fetchedAt||"Unavailable"}</td></tr>)}</tbody></table></section>:null}
    <div className="tmc-market-details">      {venueOffers.length?<section className="tmc-panel tmc-venues"><details><summary>MULTI-VENUE MARKET · {venueOffers.length} observed offers</summary><table><thead><tr><th>VENUE</th><th>MARKET / PERIOD</th><th>SELECTION</th><th>OBSERVED PRICE</th></tr></thead><tbody>{venueOffers.map((o,i)=><tr key={o.observationId||i}><td>{o.source}<small>Collected {o.collectedAt||"unavailable"}</small></td><td>{o.marketFamily} · {o.period||"unspecified"}<small>{o.standardOrAlt||"unknown"}</small></td><td>{o.participantName||o.providerSide||o.side||"unresolved"}</td><td>{offerText(o)}</td></tr>)}</tbody></table><small>Observed venue offers · informational only · Collection time is not a verified provider quote time</small></details></section>:null}
    </div>
    <div className="tmc-lower">
      {mlIntel||spIntel||totIntel?<>
      <section className="tmc-panel tmc-action"><h3>ACTION MARKET INTELLIGENCE <span>ACTION ●</span></h3><table><thead><tr><th>MARKET</th><th>SIDE</th><th>TICKETS</th><th>MONEY</th><th>GAP</th></tr></thead><tbody>
        {splitRow("Moneyline",best?.p?.fullName||best?.p?.name,mlIntel)}
        {splitRow("Spread",spread.home!=null?`${home.abbr} ${line(spread.home)}`:"—",spIntel)}
        {splitRow("Total",total.line!=null?`O/U ${total.line}`:"—",totIntel)}
        {!mlIntel&&!spIntel&&!totIntel?<tr><td colSpan="5">NO ACTION SNAPSHOT</td></tr>:null}
      </tbody></table></section>
      </>:<section className="tmc-panel tmc-action-status"><span>ACTION · No snapshot available</span></section>}
      <section className="tmc-panel"><details><summary className="tmc-context-summary">MATCH CONTEXT</summary><div className="tmc-context"><div><span>Surface</span><b>{surface||"—"}</b></div><div><span>Player rankings</span><b>{away.rank?"#"+away.rank:"—"} vs {home.rank?"#"+home.rank:"—"}</b></div><div><span>Market updated</span><b>{ref.observedAt?new Date(ref.observedAt).toLocaleTimeString("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"2-digit"}):"—"}</b></div><div><span>Model</span><b>{t.modelId||game?.model?.name||game?.modelId||"Model unavailable"}</b></div></div></details></section>
    </div>
    <div className="tmc-deep">
      <section className="tmc-panel"><h3>RECENT FORM (LAST 5)</h3><div className="tmc-form"><div><b>{home.fullName||home.name||"Player unavailable"}</b>{recent(bp1).length?<div className="tmc-form-line"><strong className="tmc-form-results">{formTokens(bp1)}</strong><em>{formRecord(bp1)}</em></div>:<span className="tmc-form-unavailable">Recent form unavailable</span>}<details><summary>Match results & opponent quality</summary>{recent(bp1).map((r,i)=><p key={i}>{r.date} · {r.result} vs {r.opponent} {r.opponentRank?`#${r.opponentRank}`:""} · {r.surface} · {r.score||"Score unavailable"}</p>)}</details><span>Hold {bp1.holdPct==null?"—":pct(bp1.holdPct)} · Break {bp1.breakPct==null?"—":pct(bp1.breakPct)}</span></div><div><b>{away.fullName||away.name||"Player unavailable"}</b>{recent(bp2).length?<div className="tmc-form-line"><strong className="tmc-form-results">{formTokens(bp2)}</strong><em>{formRecord(bp2)}</em></div>:<span className="tmc-form-unavailable">Recent form unavailable</span>}<details><summary>Match results & opponent quality</summary>{recent(bp2).map((r,i)=><p key={i}>{r.date} · {r.result} vs {r.opponent} {r.opponentRank?`#${r.opponentRank}`:""} · {r.surface} · {r.score||"Score unavailable"}</p>)}</details><span>Hold {bp2.holdPct==null?"—":pct(bp2.holdPct)} · Break {bp2.breakPct==null?"—":pct(bp2.breakPct)}</span></div></div></section>
      <section className="tmc-panel"><h3>HEAD TO HEAD</h3><div className="tmc-h2h"><strong>{h2h.meetings===0&&!h2h.recent?.length?"H2H not established":h2h.meetings==null?"H2H unavailable":`${h2h.meetings} recorded meetings`}</strong>{h2h.meetings>0?<div className="tmc-h2h-track"><span style={{width:`${100*h2h.player1Wins/h2h.meetings}%`}}/><span style={{width:`${100*h2h.player2Wins/h2h.meetings}%`}}/></div>:null}<span>{h2h.meetings>0?`${home.fullName||home.name} ${h2h.player1Wins??"—"}–${h2h.player2Wins??"—"} ${away.fullName||away.name}`:"No verified matchup record"}</span>{h2h.surfaceMeetings!=null?<small>{t.surface} · {h2h.surfaceMeetings} meetings · {h2h.surfacePlayer1Wins}–{h2h.surfacePlayer2Wins}</small>:null}{h2h.recent?.length>1?<details><summary>All recent meetings</summary>{h2h.recent.map((r,i)=><p key={i}>{r.date} · {r.tournament} · {r.surface} · {r.winner} · {r.score||"Score unavailable"}</p>)}</details>:null}{h2h.recent?.[0]?<small>{h2h.recent[0].date} · {h2h.recent[0].tournament} · {h2h.recent[0].winner} · {h2h.recent[0].score||"score unavailable"}</small>:<small>No H2H evidence in player bank</small>}</div></section>

    </div>
    <section className="tmc-panel tmc-surface-profiles"><h3>SURFACE RESEARCH PROFILES</h3><div className="tmc-surface-comparison">{[bp2,bp1].map((p,i)=><div key={i}><b>{p.fixtureName||[away,home][i].name}</b>{p.profiles?.length?<table><thead><tr><th>Surface</th><th>Matches</th><th>Elo</th><th>Serve won</th><th>Return won</th></tr></thead><tbody>{p.profiles.map(s=><tr key={s.surface} className={String(s.surface).toLowerCase()===String(t.surface).toLowerCase()?"tmc-active-surface":""}><td>{s.surface}</td><td>{s.profile?.surfaceMatches??"—"}</td><td>{s.profile?.surfaceElo?.[s.surface]==null?"—":Math.round(s.profile.surfaceElo[s.surface])}</td><td>{s.profile?.surfaceMatches>0?pct(s.profile?.servePointWin):"No sample"}</td><td>{s.profile?.surfaceMatches>0?pct(s.profile?.returnPointWin):"No sample"}</td></tr>)}</tbody></table>:<p>Surface profiles unavailable</p>}<small>{p.profiles?.[0]?.source} · Data as of {p.profiles?.[0]?.sourceAsOf||"unavailable"} · Last included match {p.profiles?.[0]?.lastMatchDate||"unavailable"} · Research only</small>{[away,home][i].canonicalId||[away,home][i].fbisPlayerId?<details><summary>Canonical player intelligence</summary><a href={`/api/tennis-player-profile?id=${encodeURIComponent([away,home][i].canonicalId||[away,home][i].fbisPlayerId)}`}>Open permanent player profile →</a><p>Player ID: {[away,home][i].canonicalId||[away,home][i].fbisPlayerId}</p><p>Hold {pct(p.holdPct)} · Break {pct(p.breakPct)} · Surface Elo {p.surfaceElo==null?"—":Math.round(p.surfaceElo)}</p><p>Source as of {[away,home][i].rankingAsOf||p.sourceAsOf||"Unavailable"}</p></details>:null}</div>)}</div></section>
    <footer className="tmc-footer"><span>FBIS TENNIS · MARKET INTELLIGENCE · {statusLabel}</span>{typeof onToggle==="function"?<button onClick={()=>onToggle(cardKey)}>{open?"Hide Details":"View Details"} →</button>:null}</footer>
    {open?<div className="tmc-advanced"><AdvancedGameDetail game={game} onClose={()=>onToggle?.(cardKey)}/>{typeof renderDetail==="function"?renderDetail(game):null}</div>:null}
      </div>
    </details>
  </article>;
}
