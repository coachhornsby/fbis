import cfbTeams from "../../../data/teams/cfb.js";
import {cfbSdvDirectionalEvidence} from "../../lib/cfbSdvDirectionalEvidence.js";
import TeamLogo from "../TeamLogo.jsx";
import "./nflDirectionalMatchups.css";

const PAIRS=[
 {id:"away-run-defense",a:"away",aUnit:"RUN DEFENSE",b:"home",bUnit:"RUN OFFENSE",off:"home",kind:"rush"},
 {id:"away-run-offense",a:"away",aUnit:"RUN OFFENSE",b:"home",bUnit:"RUN DEFENSE",off:"away",kind:"rush"},
 {id:"away-pass-defense",a:"away",aUnit:"PASS DEFENSE",b:"home",bUnit:"PASS OFFENSE",off:"home",kind:"pass"},
 {id:"away-pass-offense",a:"away",aUnit:"PASS OFFENSE",b:"home",bUnit:"PASS DEFENSE",off:"away",kind:"pass"},
];
const finite=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const read=(o,...keys)=>{for(const k of keys){const n=finite(o?.[k]);if(n!==null)return n;}return null;};
function input(game,side){
 const est=game?.cfb?.[side+"Est"]||{},fv=est.featureVector||{};
 return {...(fv.raw||{}),...fv,...(game?.cfbMatchupInput?.[side]||{}),...(game?.cfbDeepInput?.[side]||{}),...(game?.cfbFbisV2Input?.[side]||{})};
}
const values=(f,kind,def)=>kind==="rush"?
 (def?read(f,"rushEpaAllowed","defRushEpa","rushingPpaAllowed"):read(f,"rushEpa","epaRush","rushingPpa","ppaOffenseRushing")):
 (def?read(f,"passEpaAllowed","defPassEpa","passingPpaAllowed"):read(f,"passEpa","epaPass","passingPpa","ppaOffensePassing"));
export function cfbDirectionalEvidence(game){
 // Prefer the already frozen 4/4 game PIT record. When missing, render an
 // explicitly marked current-season SDV comparison, never a betting signal.
 const research=game?.cfbUnitAudit?.available!==4?cfbSdvDirectionalEvidence(game):null;
 if(research) return PAIRS.map(p=>({...p,...research.find(r=>r.id===p.id)}));
 const audited=game?.cfbUnitAudit?.tiles;
 if(audited) return PAIRS.map(p=>{
  const r=audited[p.id]||{};
  const available=r.eligible===true&&finite(r.offense)!=null&&finite(r.defense)!=null;
  const value=available?Math.round(Math.max(-1.5,Math.min(1.5,(Number(r.offense)-Number(r.defense))*3.5))*100)/100:null;
  const winner=value!=null&&Math.abs(value)>=.15?(value>0?p.off:p.off==="home"?"away":"home"):null;
  return {...p,available,value,winner,status:!available?"UNAVAILABLE":winner?"EDGE":"EVEN",reason:r.reason||null};
 });

 const start=Date.parse(String(game?.start||game?.startTime||game?.startDate||""));
 const asOf=Date.parse(String(game?.featureSnapshotAt||""));
 if(game?.featureCutoffOk!==true||!Number.isFinite(start)||!Number.isFinite(asOf)||asOf>=start)
   return PAIRS.map(p=>({...p,available:false,value:null,winner:null,status:"UNAVAILABLE"}));
 const away=input(game,"away"),home=input(game,"home");
 return PAIRS.map(p=>{
  const offense=p.off==="home"?home:away,defense=p.off==="home"?away:home;
  const o=values(offense,p.kind,false),d=values(defense,p.kind,true);
  const available=o!==null&&d!==null;
  const value=available?Math.round(Math.max(-1.5,Math.min(1.5,(o-d)*3.5))*100)/100:null;
  const winner=value!==null&&Math.abs(value)>=.15?(value>0?p.off:p.off==="home"?"away":"home"):null;
  return {...p,available,value,winner,status:!available?"UNAVAILABLE":winner?"EDGE":"EVEN"};
 });
}
function colors(t){
 const reg=cfbTeams.find(x=>String(x.espnId||"")===String(t?.espnId||"__")||x.abbr===t?.abbr)||{};
 const primary=t?.color||t?.primaryColor||reg.color;
 const secondary=t?.secondaryColor||t?.altColor||t?.alternateColor||reg.altColor;
 const hex=(v,defaultValue)=>/^#?[a-f0-9]{6}$/i.test(String(v||""))?(String(v).startsWith("#")?String(v):"#"+v):defaultValue;
 return {primary:hex(primary,"#214d76"),secondary:hex(secondary,"#b5d7ef")};
}
export default function CfbDirectionalMatchups({game,away,home}){
 const teams={away,home},rows=cfbDirectionalEvidence(game);
 const sdvResearch=rows.some(r=>r.sourceType==="SDV_SOURCE_OBSERVED_RESEARCH");
 return <section className="nfl-unit-panel cfb-unit-panel" aria-label="Four directional CFB unit matchups">
  <header><strong>GAME MATCHUP</strong><span>{sdvResearch?"4 SDV SOURCE COMPARISONS · RESEARCH ONLY":"4 DIRECTIONAL UNIT BATTLES"}</span></header>
  <div className="nfl-unit-grid">{rows.map(r=>{
   const winner=r.winner?teams[r.winner]:null,brand=winner?colors(winner):null;
   return <div key={r.id} className={`nfl-unit-tile ${winner?"has-edge":"is-neutral"}`} style={brand?{"--unit-primary":brand.primary,"--unit-secondary":brand.secondary}:undefined}>
    <div className="nfl-unit-line"><div><TeamLogo team={teams[r.a]} size={32}/><strong>{r.aUnit}</strong></div><span>VS</span><div><TeamLogo team={teams[r.b]} size={32}/><strong>{r.bUnit}</strong></div></div>
    <div className="nfl-unit-result">{winner?<><TeamLogo team={winner} size={46}/><span className="nfl-unit-winner"><small>{r.sourceType==="SDV_SOURCE_OBSERVED_RESEARCH"?"CURRENT-SEASON EPA TILT":"ADVANTAGE"}</small><strong>{winner.fullName||winner.name||winner.abbr}</strong></span></>:<strong>{r.status}</strong>}</div>
    <small>{r.sourceType==="SDV_SOURCE_OBSERVED_RESEARCH"
      ? r.available?`OFF EPA ${r.offenseEpa.toFixed(3)} · OPP DEF EPA ${r.defenseEpaAllowed.toFixed(3)} · DIFF ${r.value>0?"+":""}${r.value.toFixed(3)}`:"SDV DIRECTIONAL DATA UNAVAILABLE"
      : r.value!==null?`UNIT COMPARISON ${r.value>0?"+":""}${r.value.toFixed(2)}`: "UNIT DATA PENDING"}</small>
   </div>;
  })}</div>
  {sdvResearch?<small style={{display:"block",marginTop:8,opacity:.72}}>Source: SportsDataverse 2026 FBS summaries. Acquisition time is not provider publication proof. These comparisons are not immutable game PIT evidence, model projections, betting edges, or authorized selections.</small>:null}
 </section>;
}
