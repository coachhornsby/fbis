import {useMemo,useState} from 'react';
const fmt=v=>v==null?'Unavailable':Number(v).toFixed(3);
export default function CfbCategoryRankings({data}){
 const [category,setCategory]=useState('overall'),[conference,setConference]=useState('ALL');
 const metric=data.rankingMetrics?.find(m=>m.id===category);
 const teams=useMemo(()=>[...(data.teams||[])].filter(t=>conference==='ALL'||t.conference===conference)
  .sort((a,b)=>(a.rankings?.[category]?.rank??Infinity)-(b.rankings?.[category]?.rank??Infinity)||a.name.localeCompare(b.name)),[data,category,conference]);
 const conferences=useMemo(()=>[...(data.conferences||[])].sort((a,b)=>(a.rankings?.[category]?.rank??Infinity)-(b.rankings?.[category]?.rank??Infinity)||a.name.localeCompare(b.name)),[data,category]);
 if(!metric)return null;
 return <section aria-label="Detailed category rankings"><h3>National & conference category comparisons</h3>
  <label>Rank by <select value={category} onChange={e=>setCategory(e.target.value)}>{data.rankingMetrics.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>{' '}
  <label>Teams <select value={conference} onChange={e=>setConference(e.target.value)}><option value="ALL">All FBS</option>{data.conferences.map(c=><option key={c.name}>{c.name}</option>)}</select></label>
  <p>{metric.lowerIsBetter?'Lower':'Higher'} {metric.field} is better. Missing values are unranked. No confidence interval is supplied by this source.</p>
  <div style={{overflowX:'auto',maxHeight:420}}><table><thead><tr><th>National rank</th><th>Team</th><th>Conference</th><th>{metric.label}</th><th>Summary games</th><th>Coverage</th></tr></thead><tbody>{teams.map(t=><tr key={t.teamId}><td>{t.rankings[category].rank??'Unavailable'}</td><td><a href={`?route=teams&team=${encodeURIComponent(t.teamId)}`}>{t.name}</a></td><td>{t.conference}</td><td>{fmt(t.rankings[category].value)}</td><td>{t.games??'Unavailable'}</td><td>{t.summaryGameGap>0?`${t.summaryGameGap} final games outside summary`:t.record?'Source count reconciled':'Final-result coverage unavailable'}</td></tr>)}</tbody></table></div>
  <h4>Conference depth & interconference results</h4><p>Category values below use equal-weight member-team means. Dispersion is variation across teams, not forecast uncertainty. Interconference results exclude non-FBS opponents.</p>
  <div style={{overflowX:'auto'}}><table><thead><tr><th>Rank</th><th>Conference</th><th>{metric.label}</th><th>Contributing / members</th><th>Team dispersion</th><th>Interconference W–L–T</th><th>Pending scores</th></tr></thead><tbody>{conferences.map(c=>{const r=c.rankings[category],g=c.interconference;return <tr key={c.name}><td>{r.rank??'Unavailable'}</td><td>{c.name}</td><td>{fmt(r.value)}</td><td>{r.contributingTeams}/{r.members}</td><td>{fmt(r.withinConferenceSd)}</td><td>{g?`${g.wins}–${g.losses}–${g.ties}`:'Unavailable'}</td><td>{g?.pending??'Unavailable'}</td></tr>;})}</tbody></table></div>
  <details><summary>Ranking categories awaiting qualified data</summary>{Object.entries(data.unavailableRankingFamilies||{}).map(([key,value])=><p key={key}>{key}: {value}</p>)}</details>
 </section>;
}
