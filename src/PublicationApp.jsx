import {mergeRetainedExchangeQuotes,loadRetainedExchangeQuotes,saveRetainedExchangeQuotes} from './lib/retainedExchangeQuotes.js';
import {startCbbSummaryRefresh} from './lib/cbbCardAuto.js';
import PrivateSportProjection from './components/board/PrivateSportProjection.jsx';
import {loadPublicSportSnapshot,clearPublicSportSnapshot} from './lib/publicSportAuto.js';
import {privateFourSportProjectionFor} from '../functions/lib/privateFourSportProjection.js';
import {overlayVerifiedResearchScores} from './lib/productionRecoveryOverlay.js';
import {privateProjectionFor} from './lib/privateBoardProjection.js';
import {useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import DecisionBoard from './components/board/DecisionBoard.jsx';
import PublicScoreTicker from './components/board/PublicScoreTicker.jsx';
import {startScoreboardPolling,retainFailedScoreFeeds} from '../functions/lib/publicScoreboardRefresh.js';
import {captureScoreboards,boardDate,shiftBoardDate,SNAPSHOT_MAX_AGE_MS} from '../functions/lib/publicBoardSnapshot.js';
import './index.css';
import './publication.css';
const ACTIVE_SPORTS=Object.freeze(['cbb','nfl','nba','cfb']);
function CbbReadiness({date,clock}){
  const [packet,setPacket]=useState(null);
  useEffect(()=>{const controller=new AbortController();setPacket(null);
    fetch(`/board-data/cbb-readiness/${date}.json`,{signal:controller.signal}).then(r=>r.ok?r.json():null).then(p=>{if(!controller.signal.aborted&&p?.date===date&&p.publicationMode==='READINESS_ONLY')setPacket(p);}).catch(()=>{});
    return()=>controller.abort();
  },[date]);
  if(!packet)return null;
  const expired=!Number.isFinite(Date.parse(packet.expiresAt))||clock>=Date.parse(packet.expiresAt);
  return <section className="publication-notice" aria-label="CBB projection readiness"><strong>CBB projection pipeline · {expired?'input snapshot expired':'private analysis prepared'}</strong><p>Public projections remain unavailable. Current CBBD confirmation and validated native totals are incomplete. KenPom public display requires verified written permission. No picks or wager approvals.</p><small>Snapshot for {date} · {expired?'Refresh verified inputs before further analysis.':'Private preseason estimates require confirmation before use.'}</small></section>;
}
function PublicationApp(){
  const [privatePacket,setPrivatePacket]=useState(null);
  const [privateOffers,setPrivateOffers]=useState([]);
  const [privateStatus,setPrivateStatus]=useState('LOADING');
  const [cbbRefreshBusy,setCbbRefreshBusy]=useState(false);
  const [cbbRefreshResult,setCbbRefreshResult]=useState('');
  const [modelPacket,setModelPacket]=useState(null);
  const [sportOffers,setSportOffers]=useState([]);
  const [exchangeQuotes,setExchangeQuotes]=useState({});
  const exchangeCache=useRef({});
  const [exchangeHealth,setExchangeHealth]=useState({state:'LOADING'});
  const [modelStatus,setModelStatus]=useState('IDLE');
  const url=new URL(window.location.href);
  const [sport,setSport]=useState(ACTIVE_SPORTS.includes(url.searchParams.get('sport'))?url.searchParams.get('sport'):'cbb');
  const requestedDate=url.searchParams.get('date');
  const [date,setDate]=useState(/^\d{4}-\d{2}-\d{2}$/.test(requestedDate||'')&&Number.isFinite(Date.parse(requestedDate+'T12:00:00Z'))?requestedDate:boardDate());const [board,setBoard]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [clock,setClock]=useState(Date.now()),[tour,setTour]=useState('all');
  const busyRef=useRef(false),boardRef=useRef(null),refreshRef=useRef(null);const generation=useRef(0),active=useRef(null),lastAttempt=useRef(0);
  const cbbAutoAttempted=useRef(new Set());
  const cbbSummaryRefresh=useRef(null);
  async function refresh(selected=date,force=false){
    if(busyRef.current&&!force)return;
    if(!force&&Date.now()-lastAttempt.current<60000)return;
    lastAttempt.current=Date.now();const id=++generation.current;active.current?.abort();const abort=new AbortController();active.current=abort;
    busyRef.current=true;setBusy(true);setError('');setBoard(old=>old?.date===selected?old:null);
    try{
    if(boardRef.current?.date!==selected)try{
      const r=await fetch(`/board-data/${selected}.json`,{signal:abort.signal});
      if(r.ok){const saved=await r.json();if(saved.date===selected&&id===generation.current){boardRef.current=saved;setBoard(saved);}}
    }catch{} // A live browser refresh can still recover when no saved date exists.
    const live=await captureScoreboards({date:selected,signal:abort.signal,sports:ACTIVE_SPORTS});
    if(id!==generation.current)return;
    const merged=retainFailedScoreFeeds(live,boardRef.current);boardRef.current=merged;setBoard(merged);
    const failed=ACTIVE_SPORTS.filter(s=>!live.feeds[s].ok);
    if(failed.length)setError(`Refresh unavailable for ${failed.map(s=>s.toUpperCase()).join(', ')}. Saved data, where present, retains its original timestamp.`);
    }catch(e){if(id===generation.current&&!abort.signal.aborted)setError('Score update unavailable. Keeping the last source timestamp.');}
    finally{if(id===generation.current){busyRef.current=false;setBusy(false);setClock(Date.now());}}
  }
  refreshRef.current=()=>refresh(date);
  useEffect(()=>{const u=new URL(location.href);u.searchParams.set('date',date);u.searchParams.set('sport',sport);history.replaceState({},'',u);refresh(date,true);return()=>{generation.current++;active.current?.abort();};},[date]);
  // Read only the owner-authorized minimal CBB score summary; no raw input packet.
  useEffect(()=>{
    setPrivatePacket(null);setPrivateOffers([]);setPrivateStatus('LOADING');
    if(sport!=='cbb')return;
    const reader=startCbbSummaryRefresh({date,
      onUpdate:r=>{setPrivatePacket(r.packet);setPrivateOffers(r.offers);setPrivateStatus('LOADED');},
      onError:e=>setPrivateStatus(e.message||'PRIVATE_DATA_UNAVAILABLE'),
      isVisible:()=>!document.hidden,isCurrentDate:()=>date===boardDate(),
      listen:tick=>{document.addEventListener('visibilitychange',tick);window.addEventListener('focus',tick);
        return()=>{document.removeEventListener('visibilitychange',tick);window.removeEventListener('focus',tick);};}
    });
    cbbSummaryRefresh.current=reader;
    return()=>{reader.stop();if(cbbSummaryRefresh.current===reader)cbbSummaryRefresh.current=null;};
  },[date,sport]);
  useEffect(()=>{
    let active=true,loaded=null,lastStatus=null;
    if(!['nfl','nba','cfb'].includes(sport)){setModelPacket(null);setSportOffers([]);setModelStatus('IDLE');return;}
    setModelPacket(null);setSportOffers([]);setModelStatus('LOADING');
    async function readPrivateProjection(force=false){
      if(force)clearPublicSportSnapshot(sport,date);
      try{
        const r=await loadPublicSportSnapshot(sport,date);
        if(!active)return;
        loaded=r.packet;lastStatus='LOADED';setModelPacket(r.packet);setSportOffers(r.offers);setModelStatus('LOADED');
      }catch(e){if(!active)return;
        lastStatus=e?.message||'PUBLIC_MODEL_UNAVAILABLE';setModelStatus(lastStatus);
      }
    }
    readPrivateProjection();
    // A scheduled GitHub run may finish while the board is already open.
    // R2-only read checks, no model generation, every 20 minutes while visible.
    const timer=setInterval(()=>{
      if(!active||document.hidden||date!==boardDate()||lastStatus==='PUBLIC_MODEL_UNAVAILABLE')return;
      if(loaded&&Date.parse(loaded.expiresAt)>Date.now())return;
      readPrivateProjection(true);
    },20*60*1000);
    return()=>{active=false;clearInterval(timer);};
  },[date,sport]);
  useEffect(()=>{let active=true;const scope=sport+'|'+date;
   let storage=null;try{storage=window.sessionStorage;}catch{}
   exchangeCache.current=loadRetainedExchangeQuotes(storage,scope);setExchangeQuotes(exchangeCache.current);setExchangeHealth({state:'LOADING'});
   async function read(){if(document.hidden)return;
    try{
     const response=await fetch('/api/public/exchange-quotes?'+new URLSearchParams({sport,date}),{cache:'no-store'});
     const packet=await response.json();if(!active)return;
     if(response.ok&&packet.ok&&packet.sport===sport&&packet.date===date){
      exchangeCache.current=mergeRetainedExchangeQuotes(exchangeCache.current,packet.byEvent||{},Date.now(),packet.unavailableMarkets||[]);
      saveRetainedExchangeQuotes(storage,scope,exchangeCache.current);setExchangeQuotes(exchangeCache.current);
      setExchangeHealth({state:'READY',sources:packet.marketSources||null,
       counts:packet.matchedQuoteCounts||{}});
     }else{setExchangeHealth({state:packet.code==='EXCHANGE_FEED_READ_PAUSED'?'PAUSED':'UNAVAILABLE'});}
    }catch{if(active){setExchangeHealth({state:'UNAVAILABLE'});}}
   }
   read();const timer=setInterval(read,60000);
   return()=>{active=false;clearInterval(timer);};
  },[sport,date]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer);},[]);
  useEffect(()=>startScoreboardPolling({refresh:()=>refreshRef.current?.(),isVisible:()=>!document.hidden,isBusy:()=>busyRef.current,lastAttempt:()=>lastAttempt.current,listen:fn=>{document.addEventListener('visibilitychange',fn);window.addEventListener('focus',fn);return()=>{document.removeEventListener('visibilitychange',fn);window.removeEventListener('focus',fn);};}}),[]);
  const games=(board?.games||[]).filter(g=>g.sport===sport).map(g=>{const g0=clock-Date.parse(g.capturedAt)>SNAPSHOT_MAX_AGE_MS?{...g,status:'unverified',statusDetail:'Saved source capture · current status unverified',statusClock:null}:g;const projected=overlayVerifiedResearchScores(g0,{cbbPacket:privatePacket,sportPacket:modelPacket,clock});const offers=(projected.sport==='cbb'?privateOffers:sportOffers).filter(q=>String(q.eventId||q.canonicalEventId||q.canonical_event_id||q.gameId||'')===String(projected.id));return {...projected,exchangeReferenceQuotes:exchangeQuotes[String(projected.id)]||[],recoveryVerifiedOffers:offers,...(projected.sport==='cbb'?{cbbVerifiedOffers:offers}:{})};});
  const privateMatched=privatePacket?games.filter(g=>Boolean(privateProjectionFor(g,privatePacket,clock))).length:0;
  const privatePrimary=privatePacket?.events.filter(e=>Boolean(e.primary)).length||0;
  const modelMatches=modelPacket?games.filter(g=>Boolean(privateFourSportProjectionFor(g,modelPacket,clock))).length:0;
  const feeds=Object.entries(board?.feeds||{}).filter(([s])=>sport===s);
  const stale=!feeds.length||feeds.some(([,f])=>!f.capturedAt||clock-Date.parse(f.capturedAt)>SNAPSHOT_MAX_AGE_MS||!f.ok);
  const changeSport=s=>{if(!ACTIVE_SPORTS.includes(s))return;setSport(s);setTour('all');const u=new URL(location.href);u.searchParams.set('sport',s);history.replaceState({},'',u);};
  return <main className="publication-shell fbis-shell-main route-board">
    <header className="publication-header"><a href="/" aria-label="FBIS home" className="publication-logo">FBIS<span>FASTWATER BETTING INTELLIGENCE</span></a><span className="publication-stage">FBIS PUBLIC BOARD · AUTOMATIC MODEL SCORES</span></header>
    <PublicScoreTicker games={(board?.games||[]).filter(g=>ACTIVE_SPORTS.includes(g.sport))} clock={clock} busy={busy}/>
    <section className="publication-notice" aria-label="Four sport recovery status"><strong>CBB, NFL, NBA and CFB are the active recovery sports.</strong><p>Schedules and observed scores come from ESPN. Available, verified FBIS-owned research projections for NFL, NBA and CFB appear automatically on matching game cards without sign-in. CBB scores use current KenPom ratings and the FBIS formula, labeled provisional research. Raw ratings and API keys stay server-side. Missing or expired projections stay unavailable. Bounded Kalshi and Polymarket market reads are enabled. Exchange quotes are reference prices; wagering remains disabled.</p></section>
    {!privatePacket&&privateStatus==='NO_CBB_SNAPSHOT'&&sport==='cbb'&&<CbbReadiness date={date} clock={clock}/>}
    <nav className="publication-sports" aria-label="Sports">{ACTIVE_SPORTS.map(s=><button key={s} aria-pressed={sport===s} onClick={()=>changeSport(s)}>{s.toUpperCase()}{board&&<small>{board.games.filter(g=>g.sport===s||s==='all').length}</small>}</button>)}</nav>
    <section className="publication-controls" aria-label="Board controls"><label>Central date <input type="date" value={date} min={shiftBoardDate(boardDate(),-7)} max={shiftBoardDate(boardDate(),7)} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><button onClick={()=>setDate(boardDate())}>Today</button><button onClick={()=>setDate(shiftBoardDate(boardDate(),1))}>Tomorrow</button><button disabled={busy||clock-lastAttempt.current<60000} onClick={()=>{refresh();cbbSummaryRefresh.current?.refresh();}}>{busy?'Refreshing sources…':'Refresh scores'}</button>{sport==='tennis'&&<label>Tour <select value={tour} onChange={e=>setTour(e.target.value)}><option value="all">ATP + WTA</option><option value="atp">ATP</option><option value="wta">WTA</option></select></label>}</section>
    <div className="publication-freshness" role="status"><b>{stale?'SAVED / STALE OR PARTIAL':'CURRENT SOURCE CAPTURE'}</b> · {games.length} games · Times shown in Central. Scores update automatically every minute while this page is visible. Captures become stale after five minutes.<br/>{feeds.map(([s,f])=><span key={s}>{s.toUpperCase()}: {f.capturedAt?new Date(f.capturedAt).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'unavailable'} CT{!f.ok?' · source unavailable':''}　</span>)}</div>
    <div className="publication-freshness" role="status" aria-label="Exchange market coverage">
     <b>EXCHANGE MARKET CAPTURE</b> · {exchangeHealth.state==='LOADING'?'Checking verified snapshot coverage…':
      exchangeHealth.state==='PAUSED'?'Read budget or feed policy paused — missing quotes do not mean no market exists.':
      exchangeHealth.state==='UNAVAILABLE'?'Exchange feed unavailable — missing quotes do not mean no market exists.':
      <>
       Kalshi: {['moneyline','spread','total','team_total'].map((family,i)=><span key={family}>{['ML','Spread','Total','Team total'][i]} {exchangeHealth.sources?.Kalshi?.[family]?.state||'UNKNOWN'}　</span>)}
       Polymarket: {exchangeHealth.sources?.Polymarket?.state||'UNKNOWN'} ·
       {' '}Matched references: {Object.values(exchangeHealth.counts||{}).reduce((sum,families)=>sum+Object.values(families).reduce((n,x)=>n+x,0),0)}
      </>}
    </div>
    {error&&<p className="publication-warning" role="alert">{error}</p>}
    {board&&!games.length&&!busy&&<p className="publication-empty">{feeds.every(([,f])=>f.ok)?'No games returned by the source for this date and filter.':'Schedule unavailable for this filter. This is not a confirmed empty slate.'}</p>}
    {sport==='cbb'&&<section className="publication-controls" aria-label="CBB projection availability" role="status">
      <span>{privatePacket?`${privateMatched} CBB research projections matched · KenPom ratings / FBIS formula · provisional`:'CBB projection output is loading or unavailable. Missing inputs stay blank.'}</span>
    </section>}
    {sport!=='cbb'&&<section className="publication-controls" aria-label="Private sport projections" role="status">
      <span>{modelPacket?`${modelMatches} verified ${sport.toUpperCase()} research projections matched to game cards on ${date} · ${clock>=Date.parse(modelPacket.expiresAt)?'HISTORICAL / EXPIRED':'RESEARCH ONLY'}`:modelStatus==='LOADING'?`Checking public ${sport.toUpperCase()} model snapshot…`:modelStatus==='NO_PUBLIC_MODEL_SNAPSHOT'?`No generated ${sport.toUpperCase()} model snapshot for ${date}`:`Current ${sport.toUpperCase()} model output unavailable.`}</span>
    </section>}
    <section aria-label="Game cards"><DecisionBoard compactRecovery clock={clock} key={date+sport} games={games} renderCardExtra={g=>g.sport==='cbb'?null:<PrivateSportProjection game={g} packet={modelPacket} clock={clock}/>}/></section>
    <footer className="publication-footer">Four priority sports: CBB, NFL, NBA and CFB. Live scores use bounded ESPN requests; public FBIS-owned model summaries come from private R2 through a sanitized anonymous read route, never D1. CBB cards show derived research scores; raw provider inputs stay server-side; player props, wagers and broad provider collectors remain paused. Bounded exchange market reads and private research refresh are active; no model is an approved wager.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<PublicationApp/>);
