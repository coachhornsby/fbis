import "./matchupSignals.css";
import TeamLogo from '../TeamLogo.jsx';
import {matchupAdvantageTeam,matchupSignalColors} from '../../lib/matchupTeamBrand.js';
import {splitMatchupVisual} from '../../lib/matchupVisual.js';

/** Shared NHL card artwork, supplied only with each sport's published factors. */
export default function MatchupSignals({game,away,home,sport,slots=null}) {
  const factors=Array.isArray(game?.matchupFactors)?game.matchupFactors:[];
  const rows=slots ? slots.map(slot=>({...slot,factor:factors.find(f=>String(f.id||'').toLowerCase()===slot.id)||null}))
    : factors.filter(f=>f&&typeof f==='object').map((factor,i)=>({...splitMatchupVisual(factor.id,factor.label||factor.name),id:factor.id||`factor-${i}`,factor}));
  return <section className={`cgc-matchup-read${rows.length?'':' is-unavailable'}`} aria-label="FBIS matchup analysis">
    <div className="cgc-matchup-read-head"><div><span>GAME MATCHUP</span><strong>{rows.length?'FBIS ANALYSIS':'NO ANALYTICS YET'}</strong></div><b>{rows.length?`${rows.length} SIGNALS`:'—'}</b></div>
    <div className="cgc-matchup-pills">{rows.length?rows.map(({id,icon,label,factor})=>{
      const available=factor&&factor.available!==false;
      const identified=available?matchupAdvantageTeam(factor,away,home):null;
      const team=identified?.team||null,colors=team?matchupSignalColors(team,sport):null;
      const edge=available?(factor.edge||factor.advantage||factor.team||'N/A'):'N/A';
      const neutral=/^(unavailable|unknown|unverified|not available)$/i.test(String(edge))?'N/A':String(edge).toUpperCase();
      return <div key={id} className={`cgc-matchup-pill tone-${identified?.side||'neutral'}${team?' is-team-branded':''}`}
        title={available&&factor.detail?String(factor.detail):undefined}
        style={team?{'--fbis-tile-team':colors?.primary||'#173448','--fbis-tile-border':colors?.secondary||'#83b8d2'}:undefined}>
        <span className="cgc-matchup-pill-label"><i className="cgc-matchup-icon" aria-hidden="true">{icon||'SIG'}</i><em>{label}</em></span>
        {team?<span className="cgc-matchup-team-mark" aria-hidden="true"><TeamLogo team={{...team,sport}} size={112} className="cgc-matchup-team-logo" /></span>:<strong>{neutral}</strong>}
        {available&&factor.value!=null?<small className="cgc-matchup-metric">{String(factor.value)}</small>:null}
      </div>;
    }):<div className="cgc-matchup-pill tone-neutral"><span>STATUS</span><strong>AWAITING MATCHUP DATA</strong></div>}</div>
  </section>;
}
