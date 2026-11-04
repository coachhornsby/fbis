import PrivateProjection from './components/board/PrivateProjection.jsx';
import PrivateSportProjection from './components/board/PrivateSportProjection.jsx';
import {loadSportSnapshot} from './lib/privateSportAuto.js';
import {privateFourSportProjectionFor} from '../functions/lib/privateFourSportProjection.js';
import {overlayVerifiedResearchScores} from './lib/productionRecoveryOverlay.js';
import {privateProjectionFor} from './lib/privateBoardProjection.js';
import {loadCbbSnapshot,clearCbbSnapshot} from './lib/privateCbbAuto.js';
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
  const [modelStatus,setModelStatus]=useState('IDLE');
  const url=new URL(window.location.href);
  const [sport,setSport]=useState(ACTIVE_SPORTS.includes(url.searchParams.get('sport'))?url.searchParams.get('sport'):'cbb');
  const requestedDate=url.searchParams.get('date');
  const [date,setDate]=useState(/^\d{4}-\d{2}-\d{2}$/.test(requestedDate||'')&&Number.isFinite(Date.parse(requestedDate+'T12:00:00Z'))?requestedDate:boardDate());const [board,setBoard]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [clock,setClock]=useState(Date.now()),[tour,setTour]=useState('all');
  const busyRef=useRef(false),boardRef=useRef(null),refreshRef=useRef(null);const generation=useRef(0),active=useRef(null),lastAttempt=useRef(0);
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
  useEffect(()=>{let active=true;
    if(sport!=='cbb'){setPrivatePacket(null);setPrivateOffers([]);setPrivateStatus('IDLE');return;}
    setPrivatePacket(null);setPrivateOffers([]);setPrivateStatus('LOADING');
    loadCbbSnapshot(date).then(x=>{if(active){setPrivatePacket(x.packet);setPrivateOffers(x.offers);setPrivateStatus('LOADED');}}).catch(e=>{if(active)setPrivateStatus(e.message||'UNAVAILABLE');});
    return()=>{active=false;};
  },[date,sport]);
  useEffect(()=>{
    let active=true;
    if(!['nfl','nba','cfb'].includes(sport)){setModelPacket(null);setSportOffers([]);setModelStatus('IDLE');return;}
    setModelPacket(null);setSportOffers([]);setModelStatus('LOADING');
    loadSportSnapshot(sport,date).then(r=>{if(active){setModelPacket(r.packet);setSportOffers(r.offers);setModelStatus('LOADED');}}).catch(e=>{if(active)setModelStatus(e.message||'PRIVATE_DATA_UNAVAILABLE');});
    return()=>{active=false;};
  },[date,sport]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer);},[]);
  useEffect(()=>startScoreboardPolling({refresh:()=>refreshRef.current?.(),isVisible:()=>!document.hidden,isBusy:()=>busyRef.current,lastAttempt:()=>lastAttempt.current,listen:fn=>{document.addEventListener('visibilitychange',fn);window.addEventListener('focus',fn);return()=>{document.removeEventListener('visibilitychange',fn);window.removeEventListener('focus',fn);};}}),[]);
  const games=(board?.games||[]).filter(g=>g.sport===sport).map(g=>{const g0=clock-Date.parse(g.capturedAt)>SNAPSHOT_MAX_AGE_MS?{...g,status:'unverified',statusDetail:'Saved source capture · current status unverified',statusClock:null}:g;const projected=overlayVerifiedResearchScores(g0,{cbbPacket:privatePacket,sportPacket:modelPacket,clock});const offers=(projected.sport==='cbb'?privateOffers:sportOffers).filter(q=>String(q.eventId||q.canonicalEventId||q.canonical_event_id||q.gameId||'')===String(projected.id));return {...projected,recoveryVerifiedOffers:offers,...(projected.sport==='cbb'?{cbbVerifiedOffers:offers}:{})};});
  const privateMatched=privatePacket?games.filter(g=>Boolean(privateProjectionFor(g,privatePacket,clock))).length:0;
  const privatePrimary=privatePacket?.events.filter(e=>Boolean(e.primary)).length||0;
  const modelMatches=modelPacket?games.filter(g=>Boolean(privateFourSportProjectionFor(g,modelPacket,clock))).length:0;
  const feeds=Object.entries(board?.feeds||{}).filter(([s])=>sport===s);
  const stale=!feeds.length||feeds.some(([,f])=>!f.capturedAt||clock-Date.parse(f.capturedAt)>SNAPSHOT_MAX_AGE_MS||!f.ok);
  // The owner explicitly starts a bounded, no-D1 refresh. No polling or automatic paid calls.
  async function refreshCbbOnDemand(){
    if(sport!=='cbb'||date!==boardDate()||cbbRefreshBusy)return;
    setCbbRefreshBusy(true);setCbbRefreshResult('');
    try{
      const res=await fetch('/api/private/cbb/refresh/manual',{method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-FBIS-Manual-Refresh':'1'},body:JSON.stringify({date})});
      const body=await res.json();
      if(!res.ok){
        if(body.state==='PRIVATE_AUTH_REQUIRED')setCbbRefreshResult('Private account sign-in required before refreshing.');
        else setCbbRefreshResult((body.state||'REFRESH_UNAVAILABLE')+(body.reason?' · '+body.reason:''));
        return;
      }
      clearCbbSnapshot(date);
      const updated=await loadCbbSnapshot(date);
      setPrivatePacket(updated.packet);setPrivateOffers(updated.offers);setPrivateStatus('LOADED');
      setCbbRefreshResult((body.state==='ALREADY_FRESH'?'Existing private snapshot':'Current private research snapshot')+' · '+(body.primaryProjections||0)+' provisional score forecasts · no verified bookmaker prices or approved wagers.');
    }catch{setCbbRefreshResult('Private refresh or readback unavailable. No numbers were invented.');}
    finally{setCbbRefreshBusy(false);}
  }
  const changeSport=s=>{if(!ACTIVE_SPORTS.includes(s))return;setSport(s);setTour('all');const u=new URL(location.href);u.searchParams.set('sport',s);history.replaceState({},'',u);};
  return <main className="publication-shell fbis-shell-main route-board">
    <header className="publication-header"><a href="/" aria-label="FBIS home" className="publication-logo">FBIS<span>FASTWATER BETTING INTELLIGENCE</span></a><span className="publication-stage">FOUR-SPORT RECOVERY · SCORES & PRIVATE MODELS</span></header>
    <PublicScoreTicker games={(board?.games||[]).filter(g=>ACTIVE_SPORTS.includes(g.sport))} clock={clock} busy={busy}/>
    <section className="publication-notice" aria-label="Four sport recovery status"><strong>CBB, NFL, NBA and CFB are the active recovery sports.</strong><p>Schedules and observed scores come from ESPN. Verified private model snapshots appear automatically on matching game cards; unavailable or expired predictions are labeled. No model is presented as current without its original source receipt. Market collection and wagering remain paused.</p></section>
    {!privatePacket&&privateStatus==='NO_CBB_SNAPSHOT'&&sport==='cbb'&&<CbbReadiness date={date} clock={clock}/>}
    <nav className="publication-sports" aria-label="Sports">{ACTIVE_SPORTS.map(s=><button key={s} aria-pressed={sport===s} onClick={()=>changeSport(s)}>{s.toUpperCase()}{board&&<small>{board.games.filter(g=>g.sport===s||s==='all').length}</small>}</button>)}</nav>
    <section className="publication-controls" aria-label="Board controls"><label>Central date <input type="date" value={date} min={shiftBoardDate(boardDate(),-7)} max={shiftBoardDate(boardDate(),7)} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><button onClick={()=>setDate(boardDate())}>Today</button><button onClick={()=>setDate(shiftBoardDate(boardDate(),1))}>Tomorrow</button><button disabled={busy||clock-lastAttempt.current<60000} onClick={()=>refresh()}>{busy?'Refreshing sources…':'Refresh scores'}</button>{sport==='tennis'&&<label>Tour <select value={tour} onChange={e=>setTour(e.target.value)}><option value="all">ATP + WTA</option><option value="atp">ATP</option><option value="wta">WTA</option></select></label>}</section>
    <div className="publication-freshness" role="status"><b>{stale?'SAVED / STALE OR PARTIAL':'CURRENT SOURCE CAPTURE'}</b> · {games.length} games · Times shown in Central. Scores update automatically every minute while this page is visible. Captures become stale after five minutes.<br/>{feeds.map(([s,f])=><span key={s}>{s.toUpperCase()}: {f.capturedAt?new Date(f.capturedAt).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'unavailable'} CT{!f.ok?' · source unavailable':''}　</span>)}</div>
    {error&&<p className="publication-warning" role="alert">{error}</p>}
    {board&&!games.length&&!busy&&<p className="publication-empty">{feeds.every(([,f])=>f.ok)?'No games returned by the source for this date and filter.':'Schedule unavailable for this filter. This is not a confirmed empty slate.'}</p>}
    {sport==='cbb'&&<section className="publication-controls" aria-label="Private CBB projections" role="status">
      <span>{privatePacket?`${privatePrimary} saved CBB forecasts · ${privateMatched} matched game cards on ${date} · ${clock>=Date.parse(privatePacket.expiresAt)?'HISTORICAL / INPUTS EXPIRED':'RESEARCH ONLY'}`:privateStatus==='LOADING'?'Loading owner-only CBB projections…':privateStatus==='NO_CBB_SNAPSHOT'?'No stored CBB projections for '+date:privateStatus==='PRIVATE_SIGN_IN_REQUIRED'?'Private account sign-in required to view projections.':'No verified CBB projection snapshot available for this date.'}</span>
      {privateStatus!=='LOADED'&&privateStatus!=='LOADING'&&privateStatus!=='NO_CBB_SNAPSHOT'&&<a href={'/api/private/cbb/'+date+'?login=1'}>Sign in to view CBB projections</a>}
      {date===boardDate()&&<button type="button" disabled={cbbRefreshBusy} onClick={refreshCbbOnDemand}>{cbbRefreshBusy?'Refreshing verified inputs…':'Refresh CBB inputs · manual (max 2/day)'}</button>}
      {cbbRefreshResult&&<small role="status">{cbbRefreshResult}</small>}
    </section>}
    {sport!=='cbb'&&<section className="publication-controls" aria-label="Private sport projections" role="status">
      <span>{modelPacket?`${modelMatches} verified ${sport.toUpperCase()} research projections matched to game cards on ${date} · ${clock>=Date.parse(modelPacket.expiresAt)?'HISTORICAL / EXPIRED':'RESEARCH ONLY'}`:modelStatus==='LOADING'?'Checking private ${sport.toUpperCase()} model snapshot…':modelStatus==='NO_PRIVATE_SNAPSHOT'?'No generated ${sport.toUpperCase()} model snapshot for '+date:modelStatus==='PRIVATE_SIGN_IN_REQUIRED'?'Private account sign-in required.':'Current ${sport.toUpperCase()} model output unavailable.'}</span>
      {modelStatus==='PRIVATE_SIGN_IN_REQUIRED'&&<a href={'/api/private/sports/'+sport+'/'+date+'?login=1'}>Sign in to view {sport.toUpperCase()} projections</a>}
    </section>}
    <section aria-label="Game cards"><DecisionBoard compactRecovery clock={clock} key={date+sport} games={games} renderCardExtra={g=>g.sport==='cbb'?<PrivateProjection game={g} packet={privatePacket} clock={clock}/>:<PrivateSportProjection game={g} packet={modelPacket} clock={clock}/>}/></section>
    <footer className="publication-footer">Four priority sports: CBB, NFL, NBA and CFB. Live scores use bounded ESPN requests; precomputed personal model outputs use owner-only R2, never D1. Player props, wagers, paid provider collectors and model-generation jobs remain paused until their inputs are restored.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<PublicationApp/>);
