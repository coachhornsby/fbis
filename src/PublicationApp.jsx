import {useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import DecisionBoard from './components/board/DecisionBoard.jsx';
import PublicScoreTicker from './components/board/PublicScoreTicker.jsx';
import {startScoreboardPolling,retainFailedScoreFeeds} from '../functions/lib/publicScoreboardRefresh.js';
import {PUBLIC_SPORTS,captureScoreboards,boardDate,shiftBoardDate,SNAPSHOT_MAX_AGE_MS} from '../functions/lib/publicBoardSnapshot.js';
import {applyCbbOfficialSlate} from '../functions/lib/cbbOfficialFixtures.js';
import officialCbbSchedule from '../data/public/cbb-fixture-resolutions/2026-11-02.json';
import './index.css';
import './publication.css';
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
  const url=new URL(window.location.href);
  const [sport,setSport]=useState(PUBLIC_SPORTS.includes(url.searchParams.get('sport'))?url.searchParams.get('sport'):'cbb');
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
    const live=await captureScoreboards({date:selected,signal:abort.signal});
    if(id!==generation.current)return;
    const merged=retainFailedScoreFeeds(live,boardRef.current);boardRef.current=merged;setBoard(merged);
    const failed=PUBLIC_SPORTS.filter(s=>!live.feeds[s].ok);
    if(failed.length)setError(`Refresh unavailable for ${failed.map(s=>s.toUpperCase()).join(', ')}. Saved data, where present, retains its original timestamp.`);
    }catch(e){if(id===generation.current&&!abort.signal.aborted)setError('Score update unavailable. Keeping the last source timestamp.');}
    finally{if(id===generation.current){busyRef.current=false;setBusy(false);setClock(Date.now());}}
  }
  refreshRef.current=()=>refresh(date);
  useEffect(()=>{const u=new URL(location.href);u.searchParams.set('date',date);u.searchParams.set('sport',sport);history.replaceState({},'',u);refresh(date,true);return()=>{generation.current++;active.current?.abort();};},[date]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer);},[]);
  useEffect(()=>startScoreboardPolling({refresh:()=>refreshRef.current?.(),isVisible:()=>!document.hidden,isBusy:()=>busyRef.current,lastAttempt:()=>lastAttempt.current,listen:fn=>{document.addEventListener('visibilitychange',fn);window.addEventListener('focus',fn);return()=>{document.removeEventListener('visibilitychange',fn);window.removeEventListener('focus',fn);};}}),[]);
  const games=applyCbbOfficialSlate(board?.games||[],officialCbbSchedule,clock).filter(g=>(sport==='all'||g.sport===sport)&&(sport!=='tennis'||tour==='all'||g.tour===tour)).map(g=>clock-Date.parse(g.capturedAt)>SNAPSHOT_MAX_AGE_MS?{...g,status:'unverified',statusDetail:'Saved source capture · current status unverified',statusClock:null}:g);
  const feeds=Object.entries(board?.feeds||{}).filter(([s])=>sport==='all'||sport===s);
  const stale=!feeds.length||feeds.some(([,f])=>!f.capturedAt||clock-Date.parse(f.capturedAt)>SNAPSHOT_MAX_AGE_MS||!f.ok);
  const changeSport=s=>{setSport(s);setTour('all');const u=new URL(location.href);u.searchParams.set('sport',s);history.replaceState({},'',u);};
  return <main className="publication-shell fbis-shell-main route-board">
    <header className="publication-header"><a href="/" aria-label="FBIS home" className="publication-logo">FBIS<span>FASTWATER BETTING INTELLIGENCE</span></a><span className="publication-stage">BOARD RESTART · SCHEDULES & SCORES</span></header>
    <PublicScoreTicker games={board?.games||[]} clock={clock} busy={busy}/>
    <section className="publication-notice" aria-label="Restart status"><strong>The board is open. Predictions and betting markets remain paused.</strong><p>Seven sports. Scores and schedules come from ESPN. No model picks, prices or wagering approval are implied. Historical data and recovery copies remain preserved.</p></section>
    {(sport==='cbb'||sport==='all')&&<CbbReadiness date={date} clock={clock}/>}
    <nav className="publication-sports" aria-label="Sports">{['all',...PUBLIC_SPORTS].map(s=><button key={s} aria-pressed={sport===s} onClick={()=>changeSport(s)}>{s.toUpperCase()}{board&&<small>{board.games.filter(g=>g.sport===s||s==='all').length}</small>}</button>)}</nav>
    <section className="publication-controls" aria-label="Board controls"><label>Central date <input type="date" value={date} min={shiftBoardDate(boardDate(),-7)} max={shiftBoardDate(boardDate(),7)} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><button onClick={()=>setDate(boardDate())}>Today</button><button onClick={()=>setDate(shiftBoardDate(boardDate(),1))}>Tomorrow</button><button disabled={busy||clock-lastAttempt.current<60000} onClick={()=>refresh()}>{busy?'Refreshing sources…':'Refresh scores'}</button>{sport==='tennis'&&<label>Tour <select value={tour} onChange={e=>setTour(e.target.value)}><option value="all">ATP + WTA</option><option value="atp">ATP</option><option value="wta">WTA</option></select></label>}</section>
    <div className="publication-freshness" role="status"><b>{stale?'SAVED / STALE OR PARTIAL':'CURRENT SOURCE CAPTURE'}</b> · {games.length} games · Times shown in Central. Scores update automatically every minute while this page is visible. Captures become stale after five minutes.<br/>{feeds.map(([s,f])=><span key={s}>{s.toUpperCase()}: {f.capturedAt?new Date(f.capturedAt).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'unavailable'} CT{!f.ok?' · source unavailable':''}　</span>)}</div>
    {games.some(g=>g.officialSchedule)&&<details className="publication-freshness"><summary>Official schedule references · {games.filter(g=>g.officialSchedule).length} fixtures</summary>{games.filter(g=>g.officialSchedule).map(g=><p key={g.id}><a href={g.officialSchedule.sourceUrl} target="_blank" rel="noreferrer">{g.away.name} at {g.home.name}</a> · {g.officialSchedule.decision.replaceAll('_',' ').toLowerCase()}{g.officialSchedule.remainingHolds.length?' · competition classification unverified':''}</p>)}</details>}
    {error&&<p className="publication-warning" role="alert">{error}</p>}
    {board&&!games.length&&!busy&&<p className="publication-empty">{feeds.every(([,f])=>f.ok)?'No games returned by the source for this date and filter.':'Schedule unavailable for this filter. This is not a confirmed empty slate.'}</p>}
    <section aria-label="Game cards"><DecisionBoard key={date+sport+tour} games={games}/></section>
    <footer className="publication-footer">Schedule and score capture only. Predictions, player props, account connections, wager journal writes and collection jobs remain paused. Browser refresh contacts ESPN directly; page views do not query the FBIS databases or paid AI APIs.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<PublicationApp/>);
