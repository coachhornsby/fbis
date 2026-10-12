import nflTeams from "../../../data/teams/nfl.js";
import TeamLogo from "../TeamLogo.jsx";
import "./nflDirectionalMatchups.css";

const PAIRS=[
 {id:"away-run-defense",group:"RUN",a:"away",aUnit:"RUN DEFENSE",b:"home",bUnit:"RUN OFFENSE"},
 {id:"away-run-offense",group:"RUN",a:"away",aUnit:"RUN OFFENSE",b:"home",bUnit:"RUN DEFENSE"},
 {id:"away-pass-defense",group:"PASS",a:"away",aUnit:"PASS DEFENSE",b:"home",bUnit:"PASS OFFENSE"},
 {id:"away-pass-offense",group:"PASS",a:"away",aUnit:"PASS OFFENSE",b:"home",bUnit:"PASS DEFENSE"},
];
const numeric=v=>v==null||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const color=(t,secondary=false)=>{
 const canonical=nflTeams.find(x=>x.abbr===t?.abbr);

 const v=secondary?(t?.secondaryColor||t?.secondary_color||t?.alternateColor||t?.alternate_color||t?.altColor||canonical?.altColor):(t?.color||t?.primaryColor||t?.primary_color||canonical?.color);
 return /^#?[0-9a-f]{6}$/i.test(String(v||""))?(String(v).startsWith("#")?String(v):"#"+v):null;
};
/* Directional evidence ONLY: a generic run/coverage score cannot identify which unit won. */
export function nflDirectionalEvidence(game,matchup){
 const sources=[...(Array.isArray(matchup?.unitMatchups)?matchup.unitMatchups:[]),
  ...(Array.isArray(game?.nflUnitMatchups)?game.nflUnitMatchups:[]),
  ...(Array.isArray(matchup?.signals)?matchup.signals:[]).filter(s=>PAIRS.some(p=>p.id===s?.id))];
 return PAIRS.map(p=>{
  const s=sources.find(v=>v?.id===p.id)||null;
  const value=numeric(s?.adjustment??s?.edgeValue);
  const explicit=String(s?.winner||s?.edgeSide||"").toLowerCase();
  const winner=s?.available===true?(explicit==="home"||explicit==="away"?explicit:value!=null&&Math.abs(value)>=.15?(value>0?"home":"away"):null):null;
  const status=s?.available!==true?"UNAVAILABLE":winner==null?"EVEN":"EDGE";
  return {...p,winner,status,value:s?.available===true?value:null};
 });
}
export default function NflDirectionalMatchups({game,matchup,away,home}){
 const teams={away,home},rows=nflDirectionalEvidence(game,matchup);
 return <section className="nfl-unit-panel" aria-label="Four directional NFL unit matchups">
  <header><strong>GAME MATCHUP</strong><span>4 DIRECTIONAL UNIT BATTLES</span></header>
  <div className="nfl-unit-grid">{rows.map(r=>{
   const winner=r.winner?teams[r.winner]:null;
   const primary=winner?color(winner)||"#245379":null;
   const secondary=winner?color(winner,true)||"#b7d4ed":null;
   return <div className={`nfl-unit-tile ${winner?"has-edge":"is-neutral"}`} key={r.id} style={winner?{"--unit-primary":primary,"--unit-secondary":secondary}:undefined}>
    <div className="nfl-unit-line"><div><TeamLogo team={teams[r.a]} size={32}/><strong>{r.aUnit}</strong></div><span>VS</span><div><TeamLogo team={teams[r.b]} size={32}/><strong>{r.bUnit}</strong></div></div>
    <div className="nfl-unit-result">{winner?<><TeamLogo team={winner} size={46}/><span className="nfl-unit-winner"><small>ADVANTAGE</small><strong>{winner.fullName||winner.name||winner.abbr}</strong></span></>:<strong>{r.status}</strong>}</div>
    {r.value!=null?<small>MODEL ADJUSTMENT {r.value>0?"+":""}{r.value.toFixed(2)}</small>:<small>{r.status==="UNAVAILABLE"?"DIRECTIONAL DATA PENDING":"NO MATERIAL EDGE"}</small>}
   </div>;
  })}</div>
 </section>;
}
