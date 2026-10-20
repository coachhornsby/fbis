import { useEffect, useState } from 'react';
import { LastFiveStatChart } from './FBISPlayerPropCard.jsx';
const tabs=['Overview','Historical Performance','Matchup Intelligence','Market Comparison','Model Research','Results & Learning'];
export default function ExchangePlayerWorkspace({row,onClose}) {
  const [tab,setTab]=useState(tabs[0]);
  useEffect(()=>{setTab(tabs[0]);},[row.id]);
  return <section className="props-workspace" aria-label={`${row.player_name} research`}>
    <div className="props-workspace-header"><h2>{row.player_name} · {row.canonical_market?.replaceAll('_',' ')}</h2><button type="button" className="header-btn" onClick={onClose}>Close research</button></div>
    <div className="exchange-prop-tabs" aria-label="Research sections">{tabs.map(t=><button type="button" key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</div>
    {tab==='Overview'?<><p>{row.team} vs {row.opponent} · {row.start_time}</p><p>{row.provider} · {row.side?.toUpperCase()} {row.line} · {row.period}</p><p>Independent projection: unavailable. Calibrated probability: unavailable. Research only.</p><ul>{row.reasons.map(r=><li key={r}>{r.replaceAll('_',' ')}</li>)}</ul></>:null}
    {tab==='Historical Performance'?<><LastFiveStatChart row={row}/><p>Bars apply the selected contract threshold retroactively. Historical frequency is not calibrated probability.</p><p>Last 10, season splits, workload and distribution: pending verified history integration.</p></>:null}
    {tab==='Matchup Intelligence'?<p>Sport-specific matchup evidence is not yet joined to this contract. No unsupported adjustments applied.</p>:null}
    {tab==='Market Comparison'?<><table><thead><tr><th>Provider</th><th>Contract</th><th>Side</th><th>Buy ask</th><th>Depth</th><th>Observed</th></tr></thead><tbody><tr><td>{row.provider}</td><td>{row.contractId}</td><td>{row.side}</td><td>{row.purchaseAsk}</td><td>{row.executableSize}</td><td>{row.observedAt}</td></tr></tbody></table><p>Settlement: {row.settlementTerms}</p><p>Fees unavailable. Fee-adjusted return unavailable. Cross-exchange equivalence has not been verified.</p></>:null}
    {tab==='Model Research'?<p>No frozen independent model prediction has been joined to this contract. Validation, calibration, model version and feature contributions remain unavailable.</p>:null}
    {tab==='Results & Learning'?<p>Official outcome pending. This observation is not a recorded wager. No personal performance or learning record is created from viewing it.</p>:null}
  </section>;
}
