import {useEffect,useMemo,useState} from "react";
import TeamLogo from "../../components/TeamLogo.jsx";
import {enrichTeam} from "../../../functions/lib/teams.js";
import "./simulationRankings.css";

const ORDER_OPTIONS=[
 ["winPct","Win probability"],["blowoutPct","Blowout probability"],
 ["margin","Projected margin"],["total","Projected total"],["kickoff","Kickoff time"],
];
const number=v=>typeof v==="number"&&Number.isFinite(v);
const pct=v=>number(v)?v.toFixed(1)+"%":"—";
const score=v=>number(v)?v.toFixed(1):"—";
const date=s=>Number.isFinite(Date.parse(s||""))?
 new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"short",
  month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(s)):"—";
const age=s=>{
 if(!Number.isFinite(Date.parse(s||"")))return "Unknown source time";
 const hours=Math.max(0,Math.round((Date.now()-Date.parse(s))/3600000));
 return hours<1?"Under 1 hour old":hours+"h since source freeze";
};
export default function SimulationRankingsView(){
 const [sport,setSport]=useState("nfl"),[week,setWeek]=useState(0);
 const [sort,setSort]=useState("winPct"),[direction,setDirection]=useState("desc");
 const [refresh,setRefresh]=useState(0);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 const [payload,setPayload]=useState(null);
 useEffect(()=>{
  const ac=new AbortController();
  setLoading(true);setError("");
  fetch("/api/football-simulation-rankings?"+new URLSearchParams({
   sport,week:String(week),sort,direction,refresh:String(refresh),
  }),{signal:ac.signal,cache:"no-store"})
   .then(async r=>{const b=await r.json();if(!r.ok||b.ok!==true)throw Error(b.error||"Rankings unavailable");return b})
   .then(setPayload).catch(e=>{if(e.name!=="AbortError"){setPayload(null);setError(String(e.message||e))}})
   .finally(()=>{if(!ac.signal.aborted)setLoading(false)});
  return ()=>ac.abort();
 },[sport,week,sort,direction,refresh]);
 const rows=payload?.results||[];
 const complete=rows.filter(r=>r.probabilityComplete).length;
 const n=rows.length,avgWin=useMemo(()=>{
  const p=rows.map(x=>x.winPct).filter(number);
  return p.length?p.reduce((a,b)=>a+b,0)/p.length:null;
 },[rows]);
 const toggleSort=field=>{if(sort===field)setDirection(x=>x==="desc"?"asc":"desc");
  else{setSort(field);setDirection("desc");}};
 return <section className="simrank-view" aria-label="FBIS football simulation rankings">
  <div className="simrank-header">
   <div><div className="simrank-overline">FBIS / MODEL LAB / FOOTBALL</div>
    <h2>Simulation <span>Rankings</span></h2>
    <p>Full-game NFL paths and verified-drive CFB challenger simulations. Research results only—not picks or betting signals.</p>
   </div>
   <div className="simrank-signal">RESEARCH ONLY<span>NO WAGER AUTHORITY</span></div>
  </div>
  <div className="simrank-controls">
   <div className="simrank-toggle" role="group" aria-label="League">
    {["nfl","cfb"].map(s=><button key={s} type="button"
       className={sport===s?"selected":""} aria-pressed={sport===s}
       onClick={()=>{setSport(s);setWeek(0)}}>{s.toUpperCase()}</button>)}
   </div>
   <label>Slate window<select value={week} onChange={e=>setWeek(Number(e.target.value))}>
    <option value={0}>Next 7 days</option><option value={1}>Days 8–14</option>
    <option value={2}>Days 15–21</option></select></label>
   <label>Rank by<select value={sort} onChange={e=>{setSort(e.target.value);setDirection("desc")}}>
    {ORDER_OPTIONS.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <button className="simrank-refresh" type="button" onClick={()=>setRefresh(v=>v+1)}
     disabled={loading}>↻ Refresh</button>
  </div>
  <div className="simrank-kpis">
   <div><span>Ranked matchups</span><strong>{n}</strong><small>Eligible pregame records</small></div>
   <div><span>Average favored win</span><strong>{pct(avgWin)}</strong><small>Regulation lead frequency</small></div>
   <div><span>Full probabilities</span><strong>{complete}/{n}</strong><small>Including 14+ point blowouts</small></div>
   <div><span>Simulation method</span><strong className="simrank-kpi-text">{sport==="nfl"?"DRIVE MONTE CARLO":"DRIVE RESAMPLING"}</strong>
    <small>{sport==="nfl"?"5,000 game paths per matchup":"Frozen 1,000-path research receipts"}</small></div>
  </div>
  <div className="simrank-notice">
   <strong>{sport==="nfl"?"NFL • Parametric drive simulator":"CFB • Historical verified-drive challenger"}</strong>
   <span>{sport==="nfl"
    ?"Generates a possession-by-possession regulation game 5,000 times. Drive priors are preliminary, not prospectively calibrated; this is not the NFL production win-probability model."
    :"Reads stored pregame research simulations. Older CFB receipts predate the 14-point blowout metric and display — rather than a fabricated probability."}</span>
  </div>
  {sport==="nfl"&&<div className="simrank-notice"><strong>Personnel-aware challenger · v1.3</strong><span>Independent, as-of pregame research estimate. Severe receiver-group losses can change the second 1,000-path simulation, but its coefficients and probabilities are not validated. No change to the frozen v1.2 score or wagering permissions. Missing/stale reports display unverified instead of inventing an injury correction.</span></div>}
  {loading?<div className="simrank-empty" role="status">Loading research rankings…</div>:
   error?<div className="simrank-empty" role="alert">Research data unavailable: {error}. No fallback odds or fabricated simulations shown.</div>:
   !rows.length?<div className="simrank-empty">No eligible, pregame {sport.toUpperCase()} research simulations for this window. The board does not invent missing games.</div>:
   <div className="simrank-tablewrap"><table className="simrank-table">
    <thead><tr>
     <th scope="col">Rank</th><th scope="col">Matchup / winner</th>
     <th scope="col"><button onClick={()=>toggleSort("winPct")}>Win % {sort==="winPct"?(direction==="desc"?"↓":"↑"):""}</button></th>
     <th scope="col"><button onClick={()=>toggleSort("blowoutPct")}>Blowout 14+ % {sort==="blowoutPct"?(direction==="desc"?"↓":"↑"):""}</button></th>
     <th scope="col">Away score</th><th scope="col">Home score</th>
     <th scope="col"><button onClick={()=>toggleSort("total")}>Total</button></th>
     <th scope="col"><button onClick={()=>toggleSort("margin")}>Margin</button></th>
     {sport==="nfl"&&<th scope="col">Personnel v1.3 · research</th>}
     <th scope="col">Evidence</th>
    </tr></thead>
    <tbody>{rows.map((g,i)=>{
     const w=g.winnerSide==="home"?g.home:g.winnerSide==="away"?g.away:null;
     const away=enrichTeam(sport,g.away),home=enrichTeam(sport,g.home);
     const leader=g.winnerSide==="home"?home:g.winnerSide==="away"?away:null;
     return <tr key={g.id} className={g.probabilityComplete?"":"simrank-partial"}>
      <td className="simrank-rank">{i+1}</td>
      <td><div className="simrank-match">
       <div className="simrank-logo-versus">
        <TeamLogo team={{...away,sport}} size={50} tone="dark"/>
        <b aria-label="versus">VS</b>
        <TeamLogo team={{...home,sport}} size={50} tone="dark"/>
       </div>
       <div><strong>{g.away.name} <span className="simrank-name-vs">vs</span> {g.home.name}</strong>
        <span>{date(g.kickoff)}</span>
        <div className="simrank-leader" aria-label="Simulated regulation projected leader">{leader?<><span className="simrank-leader-label">PROJECTED WINNER</span><TeamLogo team={{...leader,sport}} size={26} tone="dark"/><b>{w.name}</b></>:<b>Projected winner unavailable or tied</b>}</div>
        <div className="simrank-sides"><span className={g.winnerSide==="away"?"fav":""}>{g.away.abbr} {pct(g.awayWinPct)}</span><span className={g.winnerSide==="home"?"fav":""}>{g.home.abbr} {pct(g.homeWinPct)}</span><span>Tie {pct(g.tiePct)}</span></div>
       </div></div></td>
      <td><div className="simrank-prob">{pct(g.winPct)}
        <span className="simrank-bar"><i style={{width:(g.winPct??0)+"%"}} /></span></div></td>
      <td>{number(g.blowoutPct)?<div className="simrank-prob">{pct(g.blowoutPct)}
        <span className="simrank-bar blowout"><i style={{width:g.blowoutPct+"%"}} /></span></div>:
       <span className="simrank-missing" title="This original frozen research run did not record a 14-point tail frequency">Not captured</span>}</td>
      <td className="simrank-score-win">{score(g.away.score)}</td>
      <td className="simrank-score-lose">{score(g.home.score)}</td>
      <td className="simrank-number">{score(g.total)}</td>
      <td className="simrank-number">+{score(g.margin)}</td>
      {sport==="nfl"&&<td className="simrank-personnel">
       {g.personnelChallenger?.researchEligible&&g.personnelChallenger?.adjusted?
        <div className={g.personnelChallenger.severePersonnelLoss?"simrank-personnel-card severe":"simrank-personnel-card"}>
         <strong>{g.personnelChallenger.severePersonnelLoss?"RECEIVER DEPLETION":"PERSONNEL SHADOW"}</strong>
         <span>As-of {date(g.personnelChallenger.capturedAt)}</span>
         <b>{g.away.abbr} {score(g.personnelChallenger.simulation?.away)} · {g.home.abbr} {score(g.personnelChallenger.simulation?.home)}</b>
         <small>Model margin (home) {score(g.personnelChallenger.adjusted.margin)}</small>
         <small>{g.away.abbr} WR top-5 out: {g.personnelChallenger.away.absentTop5} · {g.home.abbr}: {g.personnelChallenger.home.absentTop5}</small>
         <small>1,000 research draws · not calibrated</small>
         {g.personnelChallenger.warnings.length>0&&<small title={g.personnelChallenger.warnings.join(", ")}>⚠ Lineup uncertainty</small>}
        </div>:
        <div className="simrank-personnel-card missing"><strong>NOT VERIFIED</strong>
         <span>No injury-aware score</span>
         <small>{g.personnelChallenger?.reason||g.personnelChallenger?.context?.warnings?.join(", ")||"Verified as-of depth/health not available"}</small>
        </div>}
      </td>}
      <td><div className="simrank-provenance"><b>{g.modelVersion}</b>
        <span>{g.iterations.toLocaleString()} draws · {g.calibrationStatus.replaceAll("_"," ").toLowerCase()}</span>
        <small>{age(g.sourceFrozenAt)}</small></div></td>
     </tr>})}</tbody></table></div>}
  <div className="simrank-notice" aria-label="Simulation performance">
   <strong>Simulation performance · {sport.toUpperCase()}</strong>
   <span>Verified Brier score, log loss, margin MAE, total MAE, probability-bucket calibration, and 14+ blowout accuracy: not available until pregame simulations are matched with official graded results. Historical replay is not prospective validation.</span>
  </div>
  {payload&&<div className="simrank-footer">
   <span>Generated {date(payload.generatedAt)} · {payload.displayed} of {payload.eligible} eligible games</span>
   <span>Tie % tracked separately; overtime not modeled. Missing metrics are never estimated from margins or odds.</span>
   <span>No automated wagering, model promotion, or implied economic edge.</span>
  </div>}
 </section>;
}
