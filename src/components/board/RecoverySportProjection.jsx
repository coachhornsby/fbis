import {projectRecoveryGame} from '../../lib/fourSportProjection.js';
const fmt=n=>Number(n).toFixed(1);
export default function RecoverySportProjection({game,packet,clock=Date.now()}){
 const p=projectRecoveryGame(game,packet,clock);if(!p)return null;
 const label=p.primary.margin>0?game.home.name:p.primary.margin<0?game.away.name:'Projected tie';
 return <section className="private-card-projection" aria-label="Private FBIS research projection">
  <strong>{p.expired||p.started?'ARCHIVED FBIS RESEARCH · NOT CURRENT':'FBIS PRIVATE RESEARCH PROJECTION · NOT A WAGER'}</strong>
  <div className="private-score-row"><span>{game.away.name}<b>{fmt(p.primary.away)}</b></span><span>{game.home.name}<b>{fmt(p.primary.home)}</b></span></div>
  <div>Projected winner <b>{label}</b> · Home margin <b>{p.primary.margin>0?'+':''}{fmt(p.primary.margin)}</b> · Projected total <b>{fmt(p.primary.total)}</b></div>
  <small>Model {p.primary.modelId} · Sources: {p.sources.join(', ')} · Generated {new Date(p.generatedAt).toLocaleString('en-US',{timeZone:'America/Chicago'})} CT</small>
  <div className="cbb-market-unavailable">No verified matching sportsbook price. No edge or best-value wager can be calculated.</div>
  <small>{p.expired?'Snapshot expired':p.started?'Game started; frozen pregame record':'Input expiry '+new Date(p.expiresAt).toLocaleString('en-US',{timeZone:'America/Chicago'})+' CT'} · No wager approval</small>
 </section>;
}
