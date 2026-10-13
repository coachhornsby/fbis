import TeamLogo from "../TeamLogo.jsx";
import {matchupAdvantageTeam,matchupSignalColors} from "../../lib/matchupTeamBrand.js";

const slots=[
  {id:"five-v-five",icon:"5V5",label:"5V5 xG"},
  {id:"goaltending",icon:"G",label:"GOALTENDING"},
  {id:"special-teams",icon:"ST",label:"SPECIAL TEAMS"},
  {id:"high-danger",icon:"HD",label:"HIGH DANGER"},
  {id:"rest",icon:"RST",label:"REST"},
];
const missing=v=>v==null||/^(unavailable|unknown|unverified|not available|n\/a)$/i.test(String(v).trim());
/** Featured NHL view uses the existing compact-card five-signal visual contract. */
export default function NhlMatchupSignals({game,away,home}){
 const factors=Array.isArray(game?.matchupFactors)?game.matchupFactors:[];
 return <section className="cgc-matchup-read" aria-label="FBIS matchup analysis">
   <div className="cgc-matchup-read-head"><div><span>GAME MATCHUP</span><strong>FBIS ANALYSIS</strong></div><b>5 SIGNALS</b></div>
   <div className="cgc-matchup-pills">
    {slots.map(slot=>{
     const factor=factors.find(f=>String(f.id||"").toLowerCase()===slot.id)||null;
     const identified=factor?.available===false?null:matchupAdvantageTeam(factor,away,home);
     const team=identified?.team||null,colors=team?matchupSignalColors(team,"nhl"):null;
     const raw=factor?.edge||factor?.advantage||factor?.team||"N/A";
     const neutral=missing(raw)?"N/A":String(raw).toUpperCase();
     const value=factor?.value==null?null:String(factor.value);
     return <div key={slot.id} className={`cgc-matchup-pill tone-${identified?.side||"neutral"}${team?" is-team-branded":""}`}
       style={team?{"--fbis-tile-team":colors?.primary||"#173448","--fbis-tile-border":colors?.secondary||"#83b8d2"}:undefined}>
       <span className="cgc-matchup-pill-label"><i className="cgc-matchup-icon" aria-hidden="true">{slot.icon}</i><em>{slot.label}</em></span>
       {team?<span className="cgc-matchup-team-mark" aria-hidden="true">
          <TeamLogo team={{...team,sport:"nhl"}} size={112} className="cgc-matchup-team-logo"/>
        </span>:<strong>{neutral}</strong>}
       {value!=null?<small className="cgc-matchup-metric">{value}</small>:null}
      </div>;
    })}
   </div>
 </section>;
}
