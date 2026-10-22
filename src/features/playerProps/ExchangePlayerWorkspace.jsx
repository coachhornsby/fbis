import { useEffect,useState,useRef } from 'react';
import { LastFiveStatChart } from './FBISPlayerPropCard.jsx';
import { fetchPropResearch } from './propResearchClient.js';
import { formatMarketLabel } from './buildPlayerPropsBoard.js';
const tabs=['Overview','Historical Performance','Matchup Intelligence','Market Comparison','Model Research','Results & Learning'];
const fmt=v=>v==null?'—':typeof v==='number'?Number(v.toFixed(2)):String(v);
const pct=v=>v==null?null:`${(v*100).toFixed(1)}%`;
const date=v=>v?new Date(v).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' CT':null;
function Facts({values}) {return <dl className="prop-research-facts">{Object.entries(values).filter(([,v])=>v!=null&&v!=='').map(([k,v])=><div key={k}><dt>{k}</dt><dd>{fmt(v)}</dd></div>)}</dl>;}
const inputLabels={passEpaAllowed:'Pass EPA allowed',rushEpaAllowed:'Rush EPA allowed',pressureRate:'Pressure rate',allowed:'Opponent allowed to position',leagueAllowed:'League average allowed',positionDefenseFactor:'Position adjustment',positionDefenseStrength:'Adjustment weight',avgTimeToThrow:'Time to throw (seconds)',cpoe:'Completion % above expected',passerRating:'Passer rating'};
function inputValue(k,v){if(typeof v==='boolean')return v?'Available':'Unavailable';if(['pressureRate','positionDefenseStrength'].includes(k))return pct(v);if(['passEpaAllowed','rushEpaAllowed'].includes(k))return Number(v).toFixed(3);if(k==='market')return formatMarketLabel(v);return fmt(v);}
function StatTable({values}) {const entries=Object.entries(values||{}).filter(([,v])=>v!=null&&typeof v!=='object');return entries.length?<table className="exchange-prop-coverage"><tbody>{entries.map(([k,v])=><tr key={k}><th>{inputLabels[k]||formatMarketLabel(k.replace(/([a-z0-9])([A-Z])/g,'$1 $2'))}</th><td>{inputValue(k,v)}</td></tr>)}</tbody></table>:null;}
export default function ExchangePlayerWorkspace({row,onClose}) {
 const dialog=useRef(null);
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 const [tab,setTab]=useState(tabs[0]),[state,setState]=useState({loading:true,data:null,error:''}),[threshold,setThreshold]=useState(row.line);
 useEffect(()=>{let canceled=false;setTab(tabs[0]);setThreshold(row.line);setState({loading:true,data:null,error:''});fetchPropResearch(row).then(data=>{if(!canceled)setState({loading:false,data,error:''});}).catch(e=>{if(!canceled)setState({loading:false,data:null,error:e.message});});return()=>{canceled=true;};},[row.id]);
 const d=state.data,h=d?.history,m=d?.model||row,p=d?.player||{},inputs=m.researchInputs||{},contracts=d?.contracts||[],contract=d?.selectedContract;
 const viewRow={...row,line:threshold};
 const alternatives=[...new Set(contracts.map(c=>c.line).filter(v=>v!=null))].sort((a,b)=>a-b);
 const recent=h?.last10||[];
 const over=threshold==null?null:recent.filter(g=>g.value>threshold).length,under=threshold==null?null:recent.filter(g=>g.value<threshold).length;
 return <dialog ref={dialog} onCancel={onClose} className="props-workspace prop-research-dialog" aria-label={`${row.player_name} research`}>
  <div className="props-workspace-header"><div><span className="prop-workspace-kicker">FBIS PLAYER RESEARCH · {row.sport?.toUpperCase()}</span><h2>{row.player_name}</h2><p>{formatMarketLabel(row.canonical_market)} · {row.team} vs {row.opponent} · {date(row.start_time)}</p></div><button type="button" className="header-btn" onClick={onClose}>Close research</button></div>
  <div className="exchange-prop-tabs" aria-label="Research sections">{tabs.map(t=><button type="button" key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</div>
  {state.loading?<p role="status">Loading verified player research…</p>:null}{state.error?<p role="alert">Research unavailable: {state.error}</p>:null}
  {tab==='Overview'?<>
   <div className="prop-research-summary"><Facts values={{'FBIS projection':m.fbis_projection,'Selected threshold':threshold,'Stat gap':threshold==null?null:fmt(m.fbis_projection-threshold),'Last 5 average':h?.recent5?.average,'Availability':p.availability,'Role':p.role||inputs.role}}/></div>
   <LastFiveStatChart row={viewRow} history={h}/>
   <Facts values={{'Position':p.position||row.position,'Jersey':p.jersey?`#${p.jersey}`:null,'Expected snap share':pct(p.expectedSnapShare),'Recent snap share':pct(p.snapShare??inputs.snapShare),'Model uncertainty (σ)':m.sigma}}/>
   {p.injury?<p className="prop-research-note">Availability: {p.injury} · {p.practice||p.availability}. Updated {date(p.asOf)}.</p>:null}
   <p className="prop-research-note">{m.modelId} · Independent player projection. {state.loading?'Loading exchange thresholds…':`${alternatives.length} exchange thresholds available in Market Comparison.`} Threshold probabilities remain uncalibrated.</p>
  </>:null}
  {tab==='Historical Performance'?<>
   <LastFiveStatChart row={viewRow} history={h}/>{h?.available?<>
    <Facts values={{'Last 5 average':h.recent5?.average,'Last 10 average':h.recent10?.average,'Current season average':h.partialSeason?null:h.season?.average,'Season games':h.partialSeason?null:h.season?.games,'Recent median':h.recent10?.median,'Standard deviation':h.recent10?.sd,'Home average':h.partialSeason?null:h.splits?.home?.average,'Away average':h.partialSeason?null:h.splits?.away?.average,'Over / under / push':threshold==null?null:`${over} / ${under} / ${recent.length-over-under}`}}/>
    <p className="prop-research-note">{h.source}. {h.partialSeason?'Partial history. ':''}Recent games can span seasons. Today’s threshold applies retroactively; hit frequency is not a calibrated probability.</p>
    <table className="exchange-prop-coverage"><thead><tr><th>Date</th><th>Opponent</th><th>Site</th><th>Actual</th><th>vs threshold</th></tr></thead><tbody>{recent.map(g=><tr key={g.eventId||g.date}><td>{g.date?new Date(g.date).toLocaleDateString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'2-digit'}):`${g.season} W${g.week}`}</td><td>{g.opponent}</td><td>{g.isHome==null?'—':g.isHome?'Home':'Away'}</td><td><strong>{g.value}</strong></td><td>{threshold==null?'—':g.value>threshold?'Over':g.value<threshold?'Under':'Push'}</td></tr>)}</tbody></table>
   </>:!state.loading?<p>{h?.reason?.replaceAll('_',' ')||'Verified history unavailable'}</p>:null}
  </>:null}
  {tab==='Matchup Intelligence'?<>
   <Facts values={{'Opponent':d?.matchup?.opponent||row.opponent,'Site':d?.matchup?(d.matchup.home?'Home':'Away'):null,'Availability':p.availability,'Practice':p.practice,'Injury':p.injury,'Position':p.position,'Depth role':p.role||inputs.role,'Expected minutes':p.expectedMinutes??inputs.projectedMinutes,'Expected snap share':pct(p.expectedSnapShare),'Recent snap share':pct(p.snapShare??inputs.snapShare),'Role confidence':pct(inputs.roleConfidence),'Even-strength line':p.evLine,'Power-play unit':p.powerPlayUnit,'Ice time (seconds)':p.iceTimeSeconds}}/>
   {inputs.opponentMatchup?<><h3>Opponent and position matchup</h3><StatTable values={inputs.opponentMatchup}/></>:null}
   {p.nextGen?<><h3>Next Gen player context</h3><StatTable values={p.nextGen}/></>:null}
   <Facts values={{'Profile source':p.source,'Profile updated':date(p.asOf)}}/>
  </>:null}
  {tab==='Market Comparison'?<>
   {alternatives.length?<label className="prop-threshold-select">Compare threshold <select value={threshold??''} onChange={e=>setThreshold(Number(e.target.value))}>{alternatives.map(v=><option key={v} value={v}>{v}</option>)}</select></label>:null}
   <Facts values={{'FBIS projection':m.fbis_projection,'Selected threshold':threshold,'Stat gap':threshold==null?null:fmt(m.fbis_projection-threshold)}}/>
   <div className="prop-contract-table"><table className="exchange-prop-coverage"><thead><tr><th>Exchange</th><th>Threshold</th><th>Side</th><th>Observed price</th><th>Depth</th><th>Captured (CT)</th></tr></thead><tbody>{contracts.map(c=><tr key={c.id} className={c.line===threshold?'is-selected-threshold':''}><td>{c.provider}</td><td>{c.line}</td><td>{c.statSide||c.side}</td><td>{c.observedAsk!=null?(c.observedAsk*100).toFixed(1)+'¢':c.displayPrice!=null?(c.displayPrice*100).toFixed(1)+'¢ reference':'—'}</td><td>{fmt(c.observedDepth)}</td><td>{date(c.collectedAt)}</td></tr>)}</tbody></table></div>
   {!contracts.length?<p>No matched exchange contract. This is an independent projection.</p>:null}<p className="prop-research-note">Observed prices need verified quote clocks, purchase asks, fees and matching settlement rules before they support an executable comparison.</p>
   {contract?<details><summary>Exact contract and settlement rules</summary><p>{contract.contractId}</p><p className="prop-settlement-terms">{contract.settlementTerms}</p><p>DNP: {contract.dnpSettlement}. Period: {contract.period}.</p></details>:null}
  </>:null}
  {tab==='Model Research'?<>
   <Facts values={{'Model':m.modelId,'Version':m.modelVersion,'Projection':m.fbis_projection,'Uncertainty (σ)':m.sigma,'Projection as of':date(m.modelAsOf),'Independent':m.independent===true?'Yes':'Unverified','Validation':m.validationStatus}}/>
   {inputs.notes?<p>{inputs.notes}</p>:null}
   {inputs.formBlend?<><h3>Forecast weights</h3><StatTable values={inputs.formBlend}/></>:null}
   {inputs.recent5?<><h3>Recent player form</h3><StatTable values={inputs.recent5}/></>:null}
   {m.features?<><h3>Model input coverage</h3><StatTable values={m.features}/></>:null}
   {d?.modelEvidence?<details><summary>Validation evidence and limitations</summary><pre>{JSON.stringify(d.modelEvidence,null,2)}</pre></details>:null}
   <p className="prop-research-note">Projection accuracy and contract calibration are separate checks. An uncalibrated stat gap does not receive an expected return or wager rating.</p>
  </>:null}
  {tab==='Results & Learning'?<>
   <Facts values={{'Result status':d?.results?.status,'Frozen prediction':date(m.modelAsOf),'Official actual':d?.results?.actual,'Forecast error':d?.results?.forecastError}}/>
   <p>{d?.results?.status==='PREGAME'?'This game has not started. Official results and forecast errors appear after an official result joins a frozen pregame prediction.':'An official result has not been joined to a frozen pregame prediction for this card.'}</p>
   {h?.available?<Facts values={{'Verified history games':h.games?.length,'Recent actual average':h.recent10?.average,'Recent actual range':`${h.recent10?.minimum}–${h.recent10?.maximum}`}}/>:null}
   <p className="prop-research-note">Historical player performance does not represent your wagers or profit.</p>
  </>:null}
 </dialog>;
}
