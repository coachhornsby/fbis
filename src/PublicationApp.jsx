import {useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import DecisionBoard from './components/board/DecisionBoard.jsx';
import {PUBLIC_SPORTS,captureScoreboards,boardDate,shiftBoardDate,SNAPSHOT_MAX_AGE_MS} from '../functions/lib/publicBoardSnapshot.js';
import './index.css';
import './publication.css';
function PublicationApp(){
  const url=new URL(window.location.href);
  const [sport,setSport]=useState(PUBLIC_SPORTS.includes(url.searchParams.get('sport'))?url.searchParams.get('sport'):'cbb');
  const requestedDate=url.searchParams.get('date');
  const [date,setDate]=useState(/^\d{4}-\d{2}-\d{2}$/.test(requestedDate||'')&&Number.isFinite(Date.parse(requestedDate+'T12:00:00Z'))?requestedDate:boardDate());const [board,setBoard]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [clock,setClock]=useState(Date.now()),[tour,setTour]=useState('all');const generation=useRef(0),active=useRef(null),lastAttempt=useRef(0);
  async function refresh(selected=date,force=false){
    if(busy&&!force)return;
    if(!force&&Date.now()-lastAttempt.current<60000)return;
    lastAttempt.current=Date.now();const id=++generation.current;active.current?.abort();const abort=new AbortController();active.current=abort;
    setBusy(true);setError('');setBoard(old=>old?.date===selected?old:null);
    try{
      const r=await fetch(`/board-data/${selected}.json`,{signal:abort.signal});
      if(r.ok){const saved=await r.json();if(saved.date===selected&&id===generation.current)setBoard(saved);}
    }catch{} // A live browser refresh can still recover when no saved date exists.
    const live=await captureScoreboards({date:selected,signal:abort.signal});
    if(id!==generation.current)return;
    setBoard(old=>{
      // Keep a failed sport's original capture and clock; never turn failure into no-games.
      const retained=old?.date===selected?old:null;
      if(retained){for(const s of PUBLIC_SPORTS)if(!live.feeds[s].ok){
        live.games=live.games.filter(g=>g.sport!==s).concat(retained.games.filter(g=>g.sport===s));
        live.feeds[s]={...live.feeds[s],capturedAt:retained.feeds[s]?.capturedAt||null,usingSavedCapture:true};
      }}
      return live;
    });
    const failed=PUBLIC_SPORTS.filter(s=>!live.feeds[s].ok);
    if(failed.length)setError(`Refresh unavailable for ${failed.map(s=>s.toUpperCase()).join(', ')}. Saved data, where present, retains its original timestamp.`);
    setBusy(false);setClock(Date.now());
  }
  useEffect(()=>{const u=new URL(location.href);u.searchParams.set('date',date);u.searchParams.set('sport',sport);history.replaceState({},'',u);refresh(date,true);return()=>{generation.current++;active.current?.abort();};},[date]);
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15000);return()=>clearInterval(timer);},[]);
  const games=(board?.games||[]).filter(g=>(sport==='all'||g.sport===sport)&&(sport!=='tennis'||tour==='all'||g.tour===tour)).map(g=>clock-Date.parse(g.capturedAt)>SNAPSHOT_MAX_AGE_MS?{...g,status:'unverified',statusDetail:'Saved source capture · current status unverified',statusClock:null}:g);
  const feeds=Object.entries(board?.feeds||{}).filter(([s])=>sport==='all'||sport===s);
  const stale=!feeds.length||feeds.some(([,f])=>!f.capturedAt||clock-Date.parse(f.capturedAt)>SNAPSHOT_MAX_AGE_MS||!f.ok);
  const changeSport=s=>{setSport(s);setTour('all');const u=new URL(location.href);u.searchParams.set('sport',s);history.replaceState({},'',u);};
  return <main className="publication-shell fbis-shell-main">
    <header className="publication-header"><a href="/" aria-label="FBIS home" className="publication-logo">FBIS<span>FASTWATER BETTING INTELLIGENCE</span></a><span className="publication-stage">BOARD RESTART · SCHEDULES & SCORES</span></header>
    <section className="publication-notice" aria-label="Restart status"><strong>The board is open. Predictions and betting markets remain paused.</strong><p>Seven sports. Scores and schedules come from ESPN. No model picks, prices or wagering approval are implied. Historical data and recovery copies remain preserved.</p></section>
    <nav className="publication-sports" aria-label="Sports">{['all',...PUBLIC_SPORTS].map(s=><button key={s} aria-pressed={sport===s} onClick={()=>changeSport(s)}>{s.toUpperCase()}{board&&<small>{board.games.filter(g=>g.sport===s||s==='all').length}</small>}</button>)}</nav>
    <section className="publication-controls" aria-label="Board controls"><label>Central date <input type="date" value={date} min={shiftBoardDate(boardDate(),-7)} max={shiftBoardDate(boardDate(),7)} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label><button onClick={()=>setDate(boardDate())}>Today</button><button onClick={()=>setDate(shiftBoardDate(boardDate(),1))}>Tomorrow</button><button disabled={busy||clock-lastAttempt.current<60000} onClick={()=>refresh()}>{busy?'Refreshing sources…':'Refresh scores'}</button>{sport==='tennis'&&<label>Tour <select value={tour} onChange={e=>setTour(e.target.value)}><option value="all">ATP + WTA</option><option value="atp">ATP</option><option value="wta">WTA</option></select></label>}</section>
    <div className="publication-freshness" role="status"><b>{stale?'SAVED / STALE OR PARTIAL':'CURRENT SOURCE CAPTURE'}</b> · {games.length} games · Times shown in Central. Refresh is manual; captures become stale after five minutes.<br/>{feeds.map(([s,f])=><span key={s}>{s.toUpperCase()}: {f.capturedAt?new Date(f.capturedAt).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'unavailable'} CT{!f.ok?' · source unavailable':''}　</span>)}</div>
    {error&&<p className="publication-warning" role="alert">{error}</p>}
    {board&&!games.length&&!busy&&<p className="publication-empty">{feeds.every(([,f])=>f.ok)?'No games returned by the source for this date and filter.':'Schedule unavailable for this filter. This is not a confirmed empty slate.'}</p>}
    <section aria-label="Game cards"><DecisionBoard key={date+sport+tour} games={games}/></section>
    <footer className="publication-footer">Schedule and score capture only. Predictions, player props, account connections, wager journal writes and collection jobs remain paused. Browser refresh contacts ESPN directly; page views do not query the FBIS databases or paid AI APIs.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<PublicationApp/>);
