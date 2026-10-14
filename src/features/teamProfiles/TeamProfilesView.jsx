import { useEffect, useState } from 'react';
import CfbTeamsView from '../cfbTeams/CfbTeamsView.jsx';
import TeamLogo from '../../components/TeamLogo.jsx';

export default function TeamProfilesView({refreshKey=0}) {
 const [sport,setSport]=useState('soccer'),[directory,setDirectory]=useState(null),[league,setLeague]=useState('eng.1');
 const [search,setSearch]=useState(''),[selected,setSelected]=useState(null),[profile,setProfile]=useState(null),[error,setError]=useState(null);
 useEffect(()=>{const ac=new AbortController();fetch('/api/soccer-team-profiles',{signal:ac.signal}).then(r=>r.json()).then(d=>{
  if(!d.ok)throw new Error(d.error);setDirectory(d);
 }).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>ac.abort();},[refreshKey]);
 useEffect(()=>{if(!selected)return;const ac=new AbortController();setProfile(null);setError(null);
  fetch(`/api/soccer-team-profiles?team=${encodeURIComponent(selected)}&league=${encodeURIComponent(league)}`,{signal:ac.signal})
   .then(r=>r.json()).then(d=>{if(!d.ok)throw new Error(d.error);setProfile(d);})
   .catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>ac.abort();},[selected,league,refreshKey]);
 const teams=(directory?.competitions.find(c=>c.league===league)?.teams||[]).filter(t=>t.name.toLowerCase().includes(search.toLowerCase()));
 const fmt=v=>v==null?'Unavailable':Number(v).toFixed(2);
 return <section style={{padding:20}}><div className="toolbar"><h2>FBIS Team Profiles</h2>
  <label>Sport <select value={sport} onChange={e=>setSport(e.target.value)}><option value="soccer">Soccer</option><option value="cfb">FBS football</option></select></label></div>
 {sport==='cfb'?<CfbTeamsView refreshKey={refreshKey}/>:<>
 <p>Club branding, acquired match history, and sourced rosters for the ten soccer research competitions. Betting qualification remains separate.</p>
 <label>Competition <select value={league} onChange={e=>{setLeague(e.target.value);setSelected(null);setProfile(null);}}>
 {(directory?.competitions||[]).map(c=><option key={c.league} value={c.league}>{c.league} · {c.teams.length} clubs</option>)}</select></label>{' '}
 <label>Find club <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Club name"/></label>
 {error&&<p role="alert">{error}</p>}
 {!directory&&!error&&<p>Loading team directory…</p>}
 <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:12,marginTop:20}}>
 {teams.map(t=><button key={t.id} onClick={()=>setSelected(t.id)} aria-pressed={selected===t.id}
  style={{padding:16,textAlign:'left',background:'#071827',color:'white',border:`2px solid ${t.altColor||'#305069'}`,borderLeft:`6px solid ${t.color||'#305069'}`,borderRadius:12}}>
 <TeamLogo team={t} size={44}/><strong>{t.name}</strong><div>{t.abbr} · {t.league}</div></button>)}</div>
 {selected&&!profile&&!error&&<p role="status">Loading club history and roster…</p>}
 {profile&&<article style={{marginTop:24,padding:20,border:`2px solid ${profile.team.altColor||'#305069'}`,borderRadius:12}}>
 <TeamLogo team={profile.team} size={56}/><h2>{profile.team.name}</h2>
 <p>{profile.stats.scope}. {profile.stats.sampleSize} acquired matches. As of {profile.stats.asOf}.</p>
 <div style={{display:'flex',gap:24,flexWrap:'wrap'}}><span>W-D-L: {profile.stats.wins}-{profile.stats.draws}-{profile.stats.losses}</span>
 <span>Goals for / match: {fmt(profile.stats.goalsForPerMatch)}</span><span>Goals against / match: {fmt(profile.stats.goalsAgainstPerMatch)}</span>
 <span>Clean sheets: {profile.stats.cleanSheets??'Unavailable'}</span><span>BTTS: {profile.stats.bttsRate==null?'Unavailable':`${Math.round(profile.stats.bttsRate*100)}%`}</span></div>
 <h3>Recent acquired results</h3><ul>{profile.stats.recentMatches.map(m=><li key={m.eventId}>{m.date} · {m.home?'vs':'at'} {m.opponent} · {m.goalsFor}-{m.goalsAgainst} ({m.result})</li>)}</ul>
 <h3>PitchAPI advanced team data</h3>
 <p>{profile.advanced.scope} · {profile.advanced.sampleSize} matches · {profile.advanced.availableMetrics}/{profile.advanced.metrics.length} metrics available.</p>
 <p>Latest source observation: {profile.advanced.sourceObservedAt||'Unavailable'} · Match window: {profile.advanced.historyStart||'—'} to {profile.advanced.historyEnd||'—'}.</p>
 {profile.advanced.reconciliation.storedBigChancesMismatchCount>0&&<p>Source reconciliation: {profile.advanced.reconciliation.storedBigChancesMismatchCount} stored big-chance values differ from retained PitchAPI responses. This display uses the retained source values.</p>}
 {profile.advanced.unavailableReason&&<p>{profile.advanced.unavailableReason}</p>}
 <div style={{overflowX:'auto'}}><table><thead><tr><th>Metric</th><th>Team average</th><th>Opponent average</th><th>Samples</th><th>Last 10 matches</th></tr></thead><tbody>
 {profile.advanced.metrics.map(m=><tr key={m.key}><td>{m.label}</td><td>{fmt(m.value)}</td><td>{fmt(m.opponent.value)}</td><td>{m.sampleSize}</td><td>{fmt(m.recent10.value)} ({m.recent10.sampleSize})</td></tr>)}</tbody></table></div>
 <h3>Roster</h3><p>{profile.roster.source||'Roster unavailable'}{profile.roster.observedAt?` · Acquired ${profile.roster.observedAt}`:''}{profile.roster.stale?' · Stale snapshot':''}</p>
 {profile.roster.unavailableReason&&<p>{profile.roster.unavailableReason}</p>}
 <div style={{overflowX:'auto'}}><table><thead><tr><th>Player</th><th>Position</th><th>Number</th><th>Age</th></tr></thead><tbody>
 {profile.roster.players.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.position||'—'}</td><td>{p.jersey||'—'}</td><td>{p.age??'—'}</td></tr>)}</tbody></table></div>
 </article>}
 </>}
 </section>;
}
