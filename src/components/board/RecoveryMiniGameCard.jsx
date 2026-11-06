import TeamLogo from '../TeamLogo.jsx';
import {recoveryLeanShopping} from '../../lib/recoveryLeanShopping.js';
import {recoveryCardFacts} from '../../lib/recoveryCardFacts.js';
import './recoveryMiniGameCard.css';

const validColor=(value,fallback)=>{
 const v=String(value||'').trim();
 return /^#?[0-9a-f]{6}$/i.test(v)?(v[0]==='#'?v:'#'+v):fallback;
};
const number=n=>Number.isFinite(n)?String(Math.round(n)):'—';
const american=n=>Number.isFinite(n)?(n>0?'+':'')+String(n):'—';
const localTime=value=>{
 const n=Date.parse(value);
 return Number.isFinite(n)?new Date(n).toLocaleString('en-US',{
   timeZone:'America/Chicago',weekday:'short',hour:'numeric',minute:'2-digit'
 })+' CT':'Time pending';
};
const displayName=t=>t?.name||t?.fullName||t?.abbr||'Team';
const smallName=t=>{
 const v=String(t?.abbr||'').trim();
 return v&&v!=='—'?v:displayName(t);
};

export default function RecoveryMiniGameCard({game,onOpen,clock=Date.now()}){
 const model=game?.recoveryVerifiedProjection||null;
 const facts=recoveryCardFacts(game,clock);
 const {fresh,actual}=facts;
 const shopping=recoveryLeanShopping(game,{now:clock});
 const lean=shopping.lean,book=shopping.book;
 const away=game.away||{},home=game.home||{};
 const observed=book?new Date(book.observedAt).toLocaleTimeString('en-US',{
  timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'
 }):null;
 const reason=!fresh?'Awaiting FBIS projection':shopping.state==='NO_VERIFIED_PRICES'?'Waiting for verified lines':'No supported market lean';
 const bookLabel=book?(shopping.bookCount>1?'BEST PRICE · SAME LINE':'ONLY VERIFIED BOOK'):'NO VERIFIED BOOK';
 const projectionLabel=actual?(game.status==='final'?'FINAL SCORE':'LIVE SCORE'):fresh?'FBIS PROJECTED':'PROJECTION UNAVAILABLE';
 return <article
  className={'fbis-mini-card'+(fresh?' is-projected':' is-pending')}
  style={{'--fbis-mini-away':validColor(away.color,'#147cbd'),'--fbis-mini-home':validColor(home.color,'#9e274e')}}
  data-sport={game.sport} data-game-id={game.id}
 >
  <button type="button" className="fbis-mini-open" onClick={()=>onOpen?.(game)}
   aria-label={'Open '+displayName(away)+' at '+displayName(home)+' model details'}>
   <header className="fbis-mini-header">
    <span className="fbis-mini-sport">{String(game.sport||'').toUpperCase()}</span>
    <span className="fbis-mini-time">{localTime(game.start)}</span>
    <span className={'fbis-mini-status'+(fresh?' live-model':'')}>{actual?(game.status==='final'?'FINAL':'LIVE'):fresh?'FBIS RESEARCH':'NO MODEL'}</span>
   </header>
   <div className="fbis-mini-body">
    <div className="fbis-mini-team fbis-mini-team-away">
     <TeamLogo team={away} size={53} tone="light"/>
     <strong title={displayName(away)}>{displayName(away)}</strong>
     <span>{smallName(away)}</span>
    </div>
    <div className="fbis-mini-center">
     <span>{projectionLabel}</span>
     <strong title={actual?'Observed score':fresh?'Away '+model.awayScore.toFixed(1)+', Home '+model.homeScore.toFixed(1):'No verified model score'}>
      {number(facts.awayScore)}<b>–</b>{number(facts.homeScore)}
     </strong>
     <small>{fresh||actual?'AWAY · HOME':'NO CURRENT OUTPUT'}</small>
    </div>
    <div className="fbis-mini-team fbis-mini-team-home">
     <TeamLogo team={home} size={53} tone="light"/>
     <strong title={displayName(home)}>{displayName(home)}</strong>
     <span>{smallName(home)}</span>
    </div>
   </div>
   {fresh&&<div className="fbis-mini-model-facts" aria-label="Model fair spread and total">
    <div><span>MODEL FAIR SPREAD</span><strong>{facts.fairSpread}</strong></div>
    <div><span>PROJECTED TOTAL</span><strong>{facts.total.toFixed(1)}</strong></div>
   </div>}
   <div className="fbis-mini-bottom">
    <div className="fbis-mini-lean">
     <span>MODEL LEAN</span>
     <strong className={lean?'has-lean':''}>{lean?lean.label:'—'}</strong>
     <small>{lean?'Model / market gap '+lean.differencePoints.toFixed(1)+' pts':reason}</small>
    </div>
    <div className="fbis-mini-book">
     <span>{bookLabel}</span>
     <strong>{book?book.book+'  '+american(book.american):'—'}</strong>
     <small>{book?(lean.family==='spread'?'Spread':'Total')+' '+lean.line.toFixed(1)+' · '+shopping.bookCount+' book'+(shopping.bookCount===1?'':'s')+' · '+observed+' CT':'No fresh matched sportsbook offer'}</small>
    </div>
   </div>
  </button>
  <footer className="fbis-mini-footer">
   <span>{fresh?(model.modelId||'FBIS')+' · '+(model.attribution||'research'):'No verified current forecast'}</span>
   <span>RESEARCH · NO WAGER APPROVAL</span>
  </footer>
 </article>;
}
