import {useState} from 'react';
const fmt=v=>v==null?'Unavailable':Number(v).toLocaleString('en-US',{maximumFractionDigits:3});
export default function CfbCurrentSummary({intelligence,teamId,season,error=''}){
 const [search,setSearch]=useState('');
 if(Number(season)!==2026)return <section className="ft-panel"><h3>Current SportsDataverse summary</h3><p>2026 summaries are excluded from historical season views. No historical pregame evidence is inferred.</p></section>;
 const team=intelligence?.teams?.find(t=>t.teamId===teamId);
 if(!team)return <section className="ft-panel"><h3>Current SportsDataverse summary</h3><p>{error||'Loading current source summary…'}</p></section>;
 const conference=intelligence.conferences.find(c=>c.name===team.conference);
 return <section className="ft-panel" aria-label="Current source statistics and national rankings">
  <h3>Current source statistics & national rankings</h3>
  <p>{team.name} · {team.conference} · {team.record?`${team.record.wins}–${team.record.losses}`:'Record unavailable'} · {team.games??'Unavailable'} summary games / {team.record?.sourceFbsFinalGames??'Unavailable'} FBS source final games</p>
  {team.summaryGameGap>0&&<p className="ft-note">FBS sample-count gap: {team.summaryGameGap}. A count difference does not establish which games are absent or source delay. These are current source summaries, not complete published statistical ledgers.</p>}
  <p className="ft-note">Summary scope: FBS vs FBS; {team.summaryScope?.excludedNonFbsFinalGames??'Unavailable'} non-FBS finals remain in the full record and results.</p>
  <p className="ft-note">Observed {intelligence.source.observedAt} · {intelligence.version} · Display only; production model inputs unchanged. Rating confidence intervals unavailable.</p>
  <div className="ft-headline-metrics">
   {intelligence.rankingMetrics.filter(m=>["overall","offense","defense","rush","pass","success"].some(k=>String(m.id).toLowerCase().includes(k))).slice(0,6).map(metric=>{
     const r=team.rankings?.[metric.id]||{};
     const percentile=r.rank!=null&&Number(r.eligibleTeams)>1
       ?Math.max(0,Math.min(100,Math.round((1-(Number(r.rank)-1)/(Number(r.eligibleTeams)-1))*100))):null;
     return <article key={metric.id} className="ft-headline-card">
       <span>{metric.label}</span>
       <div className="ft-headline-rank">{r.rank!=null?"#"+r.rank:"—"}<small>{r.eligibleTeams?" / "+r.eligibleTeams:""}</small></div>
       <div className="ft-headline-track" aria-hidden="true"><i style={{width:(percentile??0)+"%"}}/></div>
       <div className="ft-headline-foot"><strong>{fmt(r.value)}</strong><span>{percentile==null?"Unranked":percentile+"th percentile"}</span></div>
     </article>;
   })}
  </div>
  <details className="ft-details-table"><summary>Explore all national and conference statistical rankings</summary>
  <div className="ft-table-scroll"><table className="ft-table"><thead><tr><th>Category</th><th>National rank</th><th>Source value</th><th>Eligible teams</th><th>Conference rank</th></tr></thead><tbody>
   {intelligence.rankingMetrics.map(metric=>{const r=team.rankings[metric.id];return <tr key={metric.id}><th>{metric.label}</th><td>{r.rank??'Unavailable'}</td><td>{fmt(r.value)}</td><td>{r.eligibleTeams}</td><td>{conference?.rankings?.[metric.id]?.rank??'Unavailable'}</td></tr>;})}
  </tbody></table></div></details>
  <details><summary>All {team.availableMetrics+team.missingMetrics} summary fields · {team.missingMetrics} unavailable</summary>
   <label>Find a statistic<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="EPA, havoc, rush, red zone…"/></label>
   <div className="ft-table-scroll" style={{maxHeight:420}}><table className="ft-table"><tbody>{Object.entries(team.stats).filter(([key])=>key.replaceAll('_',' ').toLowerCase().includes(search.toLowerCase().replaceAll('_',' '))).map(([key,value])=><tr key={key}><th>{key}</th><td>{fmt(value)}</td></tr>)}</tbody></table></div>
  </details>
  <details><summary>Source final results</summary>{(team.results||[]).map(g=><p key={g.gameId}>{g.start} · {g.home?'vs':'at'} {g.opponent} · {g.scored??'Unavailable'}–{g.allowed??'Unavailable'} · {g.status}</p>)}</details>
  <details><summary>Methodology, unavailable categories & provenance</summary><p>{intelligence.methodology.team}</p><p>{intelligence.methodology.conference}</p><p>{intelligence.methodology.limitation}</p>{Object.entries(intelligence.unavailableRankingFamilies).map(([k,v])=><p key={k}>{k}: {v}</p>)}<a href={intelligence.source.url}>SportsDataverse source</a><p className="ft-note">SHA-256 {intelligence.source.sha256}</p></details>
 </section>;
}
