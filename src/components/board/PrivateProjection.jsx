import {privateProjectionFor} from '../../lib/privateBoardProjection.js';
export default function PrivateProjection({game,packet,clock}){
 const p=privateProjectionFor(game,packet,clock);if(!p)return null;
 const n=v=>v.toFixed(1),s=v=>`${v>0?'+':''}${n(v)}`;
 return <section className="private-card-projection" aria-label="Private FBIS projection">
 <strong>{p.historical?'SAVED PREGAME PROJECTION':'FBIS PRIVATE PROJECTION'}</strong>
 <div className="private-score-row"><span>{game.away.name}<b>{n(p.primary.away)}</b></span><span>{game.home.name}<b>{n(p.primary.home)}</b></span></div>
 <div>Home margin <b>{s(p.primary.margin)}</b> · Total <b>{n(p.primary.total)}</b></div>
 <small>{p.primary.attribution||p.primary.modelId} · Unconfirmed estimate</small>
 {p.comparison&&<small>Torvik comparison: {n(p.comparison.away)} – {n(p.comparison.home)} · Home margin {s(p.comparison.margin)} · Total {n(p.comparison.total)}</small>}
 <small>{p.expired?'Inputs expired':p.started?'Game started · frozen pregame estimate':`Inputs expire ${new Date(p.expiresAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})} CT`} · CBBD confirmation {p.confirmationAvailable?'available':'unavailable'} · No wager approval</small>
 </section>;
}
