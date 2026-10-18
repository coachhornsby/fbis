import React,{useEffect,useState} from 'react';
export default function ZenPrizePicksLines(){
 const [state,setState]=useState({loading:true,rows:[]});
 useEffect(()=>{let stopped=false;const control=new AbortController();
 const load=async()=>{try{const r=await fetch('/api/prizepicks-props?sport=nfl&limit=1000',{signal:control.signal});const x=await r.json();if(!stopped)setState({loading:false,rows:r.ok&&x.freshness?.current?(x.rows||[]).filter(v=>v.sourceFreshness?.current):[],current:x.freshness?.current,total:x.count,error:!r.ok});}catch{if(!stopped)setState({loading:false,rows:[],error:true});}};
 load();const timer=setInterval(load,60000);return()=>{stopped=true;clearInterval(timer);control.abort();};},[]);
 return <details className="pp-premium-section-head" style={{display:'block',padding:16}}><summary><strong>ZEN PRIZEPICKS · CURRENT NFL LINES</strong> · {state.loading?'Loading':`${state.rows.length} captured lines`}</summary>
 <p>Current market lines, including Standard, Goblin and Demon tiers. Lines without a comparable FBIS projection remain market observations.</p>
 {state.error?<p>PrizePicks source unavailable.</p>:!state.rows.length?<p>No completed current Zen capture is available.</p>:<div style={{maxHeight:420,overflow:'auto'}}><table><thead><tr><th>Player</th><th>Stat</th><th>Line / tier</th><th>FBIS</th></tr></thead><tbody>{state.rows.map(r=><tr key={r.id}><td>{r.player_name} · {r.team}</td><td>{r.stat_type}</td><td>{r.line} · {r.odds_tier}</td><td>{r.fbis_projection??'Awaiting comparable model'}</td></tr>)}</tbody></table></div>}
 <small>PrizePicks entry payouts depend on the complete slip and tier. No single-leg profit claim or wager authorization.</small>
 </details>;
}
