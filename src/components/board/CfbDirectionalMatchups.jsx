import cfbTeams from "../../../data/teams/cfb.js";
import {cfbSdvDirectionalEvidence} from "../../lib/cfbSdvDirectionalEvidence.js";
import TeamLogo from "../TeamLogo.jsx";
import "./nflDirectionalMatchups.css";
import "./cfbDirectionalMatchups.css";

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
 const derived=game?.cfbDirectionalResearch;
 if(Array.isArray(derived?.rows)&&derived.rows.length===4&&derived.authority==="RESEARCH_DISPLAY_ONLY"){
  return PAIRS.map(p=>{
   const d=derived.rows.find(x=>x.id===p.id);
   const primary=d?.cfbdDifference??d?.sdvDifference??null;
   const active=d?.cfbdDifference!=null?"CFBD_TIER3_ADJUSTED":d?.sdvDifference!=null?"SDV_SEASON":null;
   const strong=primary!=null&&Math.abs(primary)>=.05;
   const winner=strong?(primary>0?p.off:p.off==="home"?"away":"home"):null;
   return {...p,available:primary!=null,value:primary,winner,
     sourceType:active,cfbdDifference:d?.cfbdDifference??null,
     sdvDifference:d?.sdvDifference??null,disagreement:d?.disagreement===true,
     status:primary==null?"SOURCE GAP":winner?"EFFICIENCY TILT":"NEAR EVEN",
     cfbdSeason:derived.season,cfbdWeek:derived.week};
  });
 }

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
const signed3=v=>v==null?"—":`${v>0?"+":""}${Number(v).toFixed(3)}`;
export default function CfbDirectionalMatchups({game,away,home}){
 const teams={away,home},rows=cfbDirectionalEvidence(game);
 const source=game?.cfbDirectionalResearch||null;
 const cfbdRows=rows.filter(r=>r.sourceType==="CFBD_TIER3_ADJUSTED");
 const both=cfbdRows.length>0&&rows.some(r=>r.sdvDifference!=null);
 const useSource=rows.some(r=>r.sourceType==="CFBD_TIER3_ADJUSTED"||r.sourceType==="SDV_SEASON");
 const sdvOnly=rows.some(r=>r.sourceType==="SDV_SOURCE_OBSERVED_RESEARCH");
 return <section className="nfl-unit-panel cfb-unit-panel cfb-directional-v2" aria-label="CFB passing and rushing matchup comparisons">
  <header className="cfb-directional-head">
   <div className="cfb-directional-headline"><strong>GAME MATCHUP</strong>
    <span>{useSource?"2026 OPPONENT EFFICIENCY COMPARISONS":"PASSING + RUSHING UNIT COMPARISONS"}</span></div>
   <div className="cfb-directional-source-tags">
    {cfbdRows.length>0?<span className="cfb-directional-tag is-cfbd">CFBD {source?.season||2026} · WK {source?.week??"—"}</span>:null}
    {both||source?.sdv?<span className="cfb-directional-tag is-sdv">SDV 2026 · {source?.sdv?.awayGames??"—"} / {source?.sdv?.homeGames??"—"} G</span>:null}
   </div>
  </header>
  <div className="nfl-unit-grid cfb-directional-grid">{rows.map(r=>{
   const winner=r.winner?teams[r.winner]:null,brand=winner?colors(winner):null;
   const hasCfbd=r.cfbdDifference!=null,hasSdv=r.sdvDifference!=null;
   const compare=hasCfbd||hasSdv;
   return <article key={r.id} className={`nfl-unit-tile cfb-directional-tile ${winner?"has-edge":"is-neutral"}${r.disagreement?" has-disagreement":""}`} style={brand?{"--unit-primary":brand.primary,"--unit-secondary":brand.secondary}:undefined}>
    <div className="nfl-unit-line cfb-directional-pair">
     <div><TeamLogo team={teams[r.a]} size={27}/><strong>{r.aUnit}</strong></div>
     <span>VS</span>
     <div><TeamLogo team={teams[r.b]} size={27}/><strong>{r.bUnit}</strong></div>
    </div>
    <div className="nfl-unit-result cfb-directional-result">
     {winner?<TeamLogo team={winner} size={37}/>:<span className="cfb-directional-neutral-symbol">≈</span>}
     <div className="cfb-directional-result-text"><small>{r.sourceType==="CFBD_TIER3_ADJUSTED"?"CFBD EFFICIENCY TILT":r.sourceType==="SDV_SEASON"||r.sourceType==="SDV_SOURCE_OBSERVED_RESEARCH"?"SDV EFFICIENCY TILT":"UNIT COMPARISON"}</small>
      <strong>{winner?winner.fullName||winner.name||winner.abbr:r.available?"NEAR EVEN":"DATA PENDING"}</strong>
     </div>
    </div>
    {compare?<div className="cfb-directional-metrics">
      <div className="cfb-directional-metric is-cfbd"><span>CFBD ADJ. EPA GAP</span><strong>{signed3(r.cfbdDifference)}</strong></div>
      <div className="cfb-directional-metric is-sdv"><span>SDV EPA GAP</span><strong>{signed3(r.sdvDifference)}</strong></div>
     </div>:<div className="cfb-directional-legacy">{r.sourceType==="SDV_SOURCE_OBSERVED_RESEARCH"&&r.available
       ?`SDV OFF ${r.offenseEpa.toFixed(3)} · DEF ${r.defenseEpaAllowed.toFixed(3)} · Δ ${signed3(r.value)}`
       :r.value!=null?`UNIT COMPARISON ${r.value>0?"+":""}${r.value.toFixed(2)}`:"DIRECTIONAL DATA PENDING"}</div>}
    {compare?<div className="cfb-directional-status">
     <span>OFFENSE − OPP. DEFENSE</span>
     {r.disagreement?<b className="cfb-directional-disagree">SOURCES DISAGREE</b>:<b>{r.available?"DISPLAY ONLY":"NO COMPARISON"}</b>}
    </div>:null}
   </article>;
  })}</div>
  {useSource?<p className="cfb-directional-footnote">
   CFBD Tier 3 Week {source?.week??"—"} adjusted efficiency takes display priority; SDV 2026 is an independent comparison. SDV samples: away {source?.sdv?.awayGames??"—"} games, home {source?.sdv?.homeGames??"—"} games. Values are EPA/play differences, not predicted points or win probabilities. Source-feature cutoff not established; no model or betting authorization.
  </p>:sdvOnly?<p className="cfb-directional-footnote">SportsDataverse current-season source efficiency only. No fitted model or betting authorization.</p>:null}
 </section>;
