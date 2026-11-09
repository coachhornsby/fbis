import {privateFourSportProjectionFor} from '../../../functions/lib/privateFourSportProjection.js';
const fixed=n=>Number(n).toFixed(1);
export default function PrivateSportProjection({game,packet,clock}){
 const record=privateFourSportProjectionFor(game,packet,clock);
 if(!record)return null;
 const p=record.projection;
 const publicMode=packet?.visibility==='PUBLIC_MODEL_SUMMARY';
 const winner=p.margin>0?game.home:p.margin<0?game.away:null;
 const captured=new Date(record.sourceCapturedAt).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 return <section className="private-card-projection" aria-label={game.sport.toUpperCase()+' private FBIS projection'}>
   <strong>{record.historical?'SAVED MODEL · HISTORICAL':publicMode?'FBIS MODEL · PREGAME':'FBIS PRIVATE RESEARCH · PREGAME'}</strong>
   <div className="private-score-row"><span>{game.away.name}<b>{fixed(p.awayScore)}</b></span><span>{game.home.name}<b>{fixed(p.homeScore)}</b></span></div>
   <div>Model margin (home) <b>{p.margin>=0?'+':''}{fixed(p.margin)}</b> · Total <b>{fixed(p.total)}</b></div>
   <div>Projected winner <b>{winner?.name||'Tie'}</b> · Fair spread <b>{winner?winner.name+' -'+fixed(Math.abs(p.margin)):'Pick'}</b></div>
   <small>{p.modelId} · {p.modelVersion} · {record.modelAuthority.replaceAll('_',' ')} · Input observed {captured} CT</small>
   <small>{record.expired?'Expired model-input snapshot':record.started?'Game started; frozen pregame estimate':'Research projection only'} · No verified current sportsbook quotes · No wager authorization</small>
   {game.sport==='nfl'&&record.nflPlayerResearch?.rows.length>0&&<details>
    <summary>NFL player estimates · {record.nflPlayerResearch.rows.length} research stats</summary>
    <small>{record.historical?'Frozen pregame estimates':'Uncalibrated estimates'} · Availability not cleared · Not betting recommendations</small>
    <ul>{record.nflPlayerResearch.rows.map(r=><li key={r.playerId+':'+r.market}>{r.playerName} ({r.teamId==='nfl-'+game.home.espnId?game.home.name:game.away.name}) · {r.market.replaceAll('_',' ')}: <b>{fixed(r.projection)}</b> · {r.gate}</li>)}</ul>
   </details>}
 </section>;
}
