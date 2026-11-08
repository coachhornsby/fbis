import {torvikComparisonFor} from '../../../functions/lib/privateTorvikSummary.js';
export default function PrivateTorvikComparison({game,packet,clock}){
 const p=torvikComparisonFor(game,packet,clock);if(!p)return null;
 const fmt=n=>Number(n).toFixed(1),date=t=>new Date(t).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 return <section className="private-card-projection" aria-label="Private Torvik research comparison">
  <strong>{p.expired||p.started||p.statusUnverified?'SAVED TORVIK COMPARISON':'PRIVATE TORVIK COMPARISON'}</strong>
  <div className="private-score-row"><span>{game.away.name}<b>{fmt(p.comparison.away)}</b></span><span>{game.home.name}<b>{fmt(p.comparison.home)}</b></span></div>
  <div>Home margin {fmt(p.comparison.margin)} · Total {fmt(p.comparison.total)}</div>
  <small>Torvik 2027 adjusted ratings + FBIS formula. Separate research comparison, not Torvik’s published game forecast or a replacement for the primary projection.</small>
  <small>Retrieved {date(p.retrievedAt)} CT. Provider update time unknown. {p.expired?'Inputs expired.':p.started?'Game started.':p.statusUnverified?'Game status unverified.':`Inputs expire ${date(p.expiresAt)} CT.`} No betting-edge or wager approval.</small>
 </section>;
}
