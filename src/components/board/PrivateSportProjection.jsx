import {privateFourSportProjectionFor} from '../../../functions/lib/privateFourSportProjection.js';
const fixed=n=>Number(n).toFixed(1);
export default function PrivateSportProjection({game,packet,clock}){
 const record=privateFourSportProjectionFor(game,packet,clock);
 if(!record)return null;
 const p=record.projection;
 const winner=p.margin>0?game.home:p.margin<0?game.away:null;
 const captured=new Date(record.sourceCapturedAt).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 return <section className="private-card-projection" aria-label={game.sport.toUpperCase()+' private FBIS projection'}>
   <strong>{record.historical?'SAVED RESEARCH · HISTORICAL':'FBIS PRIVATE RESEARCH · PREGAME'}</strong>
   <div className="private-score-row"><span>{game.away.name}<b>{fixed(p.awayScore)}</b></span><span>{game.home.name}<b>{fixed(p.homeScore)}</b></span></div>
   <div>Model margin (home) <b>{p.margin>=0?'+':''}{fixed(p.margin)}</b> · Total <b>{fixed(p.total)}</b></div>
   <div>Projected winner <b>{winner?.name||'Tie'}</b> · Fair spread <b>{winner?winner.name+' -'+fixed(Math.abs(p.margin)):'Pick'}</b></div>
   <small>{p.modelId} · {p.modelVersion} · {record.modelAuthority.replaceAll('_',' ')} · Input observed {captured} CT</small>
   <small>{record.expired?'Expired model-input snapshot':record.started?'Game started; frozen pregame estimate':'Research projection only'} · No verified current sportsbook quotes · No wager authorization</small>
 </section>;
}
