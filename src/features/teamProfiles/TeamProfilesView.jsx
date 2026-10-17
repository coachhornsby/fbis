import { useEffect, useState } from 'react';
import CfbTeamsView from '../cfbTeams/CfbTeamsView.jsx';
import TeamLogo from '../../components/TeamLogo.jsx';
import './teamProfiles.css';

const COMPETITION_NAMES = Object.freeze({
 'eng.1':'Premier League','eng.2':'EFL Championship','esp.1':'LaLiga',
 'ita.1':'Serie A','ger.1':'Bundesliga','fra.1':'Ligue 1',
 'uefa.champions':'UEFA Champions League','uefa.europa':'UEFA Europa League',
 'usa.1':'Major League Soccer','mex.1':'Liga MX',
});
const competitionName = id => COMPETITION_NAMES[id] || id;


export default function TeamProfilesView({refreshKey=0}) {
 const [sport,setSport]=useState('soccer'),[directory,setDirectory]=useState(null),[league,setLeague]=useState('eng.1');
 const [search,setSearch]=useState(''),[selected,setSelected]=useState(null),[profile,setProfile]=useState(null),[error,setError]=useState(null);
 const [panel,setPanel]=useState('overview');
 const [competitionLogo,setCompetitionLogo]=useState(null);
 const [leagueRankings,setLeagueRankings]=useState(null),[rankError,setRankError]=useState(null);
 useEffect(()=>{const ac=new AbortController();fetch('/api/soccer-team-profiles',{signal:ac.signal}).then(r=>r.json()).then(d=>{
  if(!d.ok)throw new Error(d.error);setDirectory(d);
 }).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>ac.abort();},[refreshKey]);
 useEffect(()=>{if(!selected)return;const ac=new AbortController();setProfile(null);setError(null);
  fetch(`/api/soccer-team-profiles?team=${encodeURIComponent(selected)}&league=${encodeURIComponent(league)}`,{signal:ac.signal})
   .then(r=>r.json()).then(d=>{if(!d.ok)throw new Error(d.error);setProfile(d);})
   .catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>ac.abort();},[selected,league,refreshKey]);
 useEffect(()=>{if(sport!=='soccer')return;const ac=new AbortController();setLeagueRankings(null);setRankError(null);
   fetch(`/api/soccer-team-rankings?league=${encodeURIComponent(league)}`,{signal:ac.signal})
    .then(r=>r.json()).then(d=>{if(!d.ok)throw new Error(d.error);setLeagueRankings(d);})
    .catch(e=>{if(e.name!=='AbortError')setRankError(e.message);});return()=>ac.abort();
 },[sport,league,refreshKey]);
 // ESPN's competition record provides the actual logo asset. Do not infer image IDs from league codes.
 useEffect(()=>{
   if(sport!=='soccer')return;
   const ac=new AbortController();
   setCompetitionLogo(null);
   fetch('https://site.web.api.espn.com/apis/site/v2/sports/soccer/'+encodeURIComponent(league)+'/scoreboard',{signal:ac.signal})
    .then(r=>r.ok?r.json():null)
    .then(d=>{
      if(ac.signal.aborted)return;
      const candidate=d?.leagues?.find(l=>l?.id===league)||d?.leagues?.[0];
      const url=candidate?.logos?.find(l=>l?.rel?.includes('dark'))?.href || candidate?.logos?.[0]?.href;
      if(typeof url==='string' && /^https:\/\//.test(url))setCompetitionLogo(url);
    }).catch(()=>{});
   return()=>ac.abort();
 },[sport,league]);
 const selectedRanking=leagueRankings?.teams?.find(t=>t.id===selected);
 const teams=(directory?.competitions.find(c=>c.league===league)?.teams||[]).filter(t=>t.name.toLowerCase().includes(search.toLowerCase()));
 const fmt=v=>v==null?'Unavailable':Number(v).toFixed(2);
 return <section className="stp-page"><div className="stp-toolbar"><div><span className="stp-eyebrow">FBIS CLUB INTELLIGENCE</span><h2>Team Profiles</h2><p>Club identity, verified match performance, source rankings, and player intelligence.</p></div>
 <label className="stp-control">Sport <span className="stp-select"><select value={sport} onChange={e=>setSport(e.target.value)}><option value="soccer">Soccer</option><option value="cfb">FBS football</option></select></span></label></div>
 {sport==='cfb'?<CfbTeamsView refreshKey={refreshKey}/>:<>
 <div className="stp-filters"><label className="stp-control stp-competition-control">Competition <span className="stp-competition-select">{competitionLogo?<img src={competitionLogo} alt="" onError={()=>setCompetitionLogo(null)}/>:<span className="stp-league-placeholder" aria-hidden="true">⚽</span>}<span className="stp-competition-name">{competitionName(league)}</span><span className="stp-select stp-competition-native"><select aria-label="Competition" value={league} onChange={e=>{setLeague(e.target.value);setSelected(null);setProfile(null);setPanel('overview');}}>
 {(directory?.competitions||[]).map(c=><option key={c.league} value={c.league}>{competitionName(c.league)} · {c.teams.length} clubs</option>)}</select></span></span></label>
 <label className="stp-control">Find club <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search clubs…"/></label>
 <span className="stp-team-count">{teams.length} clubs</span></div>
 {error&&<p role="alert" className="stp-alert">{error}</p>}
 {!directory&&!error&&<p role="status">Loading club directory…</p>}
 <div className="stp-directory">{teams.map(t=><button type="button" className="stp-club-tile" key={t.id} onClick={()=>{setSelected(t.id);setPanel('overview');}} aria-pressed={selected===t.id} style={{'--stp-primary':t.color||'#284f7a','--stp-secondary':t.altColor||t.color||'#436f98'}}>
 <TeamLogo team={t} size={65} /><div><strong>{t.name}</strong><span>{t.abbr} · {competitionName(t.league)}</span></div><span className="stp-tile-arrow">↗</span></button>)}</div>
 {selected&&!profile&&!error&&<p role="status">Loading club research profile…</p>}
 {profile&&<article className="stp-profile" style={{'--stp-primary':profile.team.color||'#284f7a','--stp-secondary':profile.team.altColor||profile.team.color||'#436f98'}}>
 <header className="stp-hero"><TeamLogo team={profile.team} size={112}/><div className="stp-hero-copy"><span className="stp-eyebrow">{competitionName(profile.team.league||league)} · CLUB PROFILE</span><h2>{profile.team.name}</h2><p>{profile.stats.scope} · {profile.stats.sampleSize} observed matches</p></div></header>
 <div className="stp-kpis">
 {[
 ['FORM',profile.stats.wins+'–'+profile.stats.draws+'–'+profile.stats.losses,'Wins / draws / losses'],
 ['GOALS / MATCH',fmt(profile.stats.goalsForPerMatch),'Attack'],
 ['CONCEDED / MATCH',fmt(profile.stats.goalsAgainstPerMatch),'Defense'],
 ['CLEAN SHEETS',profile.stats.cleanSheets??'—','Verified matches'],
 ['BTTS',profile.stats.bttsRate==null?'—':Math.round(profile.stats.bttsRate*100)+'%','Both teams score']
 ].map(([label,value,detail])=><div className="stp-kpi" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>)}</div>
 <nav className="stp-tabs" aria-label="Club profile sections">{[['overview','Overview'],['metrics','Advanced metrics'],['rankings','Rankings'],['players','Players'],['data','Data lab']].map(([key,label])=><button type="button" key={key} className={panel===key?'is-active':''} aria-current={panel===key?'page':undefined} onClick={()=>setPanel(key)}>{label}</button>)}</nav>
 {panel==='overview'&&<div className="stp-section-grid"><section className="stp-panel"><h3>Recent results</h3><div className="stp-results">{profile.stats.recentMatches.map(m=><div key={m.eventId} className="stp-result"><span>{m.date} · {m.home?'vs':'at'} {m.opponent}</span><strong>{m.goalsFor}–{m.goalsAgainst}</strong><b className={m.result==='W'?'win':m.result==='L'?'loss':''}>{m.result}</b></div>)}</div></section>
 <section className="stp-panel"><h3>Club intelligence snapshot</h3><p>{profile.advanced.availableMetrics} of {profile.advanced.metrics.length} advanced metrics available from acquired source data.</p><p>{profile.advanced.advancedSourceMatches??'—'} source-backed advanced matches · {profile.advanced.advancedSourceMissing??'—'} without advanced payloads.</p><p className="stp-muted">Last observation: {profile.advanced.sourceObservedAt||'Unavailable'}</p><button type="button" className="stp-secondary-button" onClick={()=>setPanel('metrics')}>Explore advanced metrics →</button></section></div>}
 {panel==='metrics'&&<section className="stp-panel"><h3>PitchAPI advanced performance</h3><p className="stp-muted">{profile.advanced.scope} · {profile.advanced.sampleSize} acquired matches. Metrics retain their source sample sizes.</p>
 {profile.advanced.unavailableReason&&<p>{profile.advanced.unavailableReason}</p>}
 <div className="stp-metric-grid">{profile.advanced.metrics.filter(m=>m.value!=null).slice(0,8).map(m=><div key={m.key} className="stp-metric-card"><span>{m.label}</span><strong>{fmt(m.value)}</strong><small>Opponent {fmt(m.opponent.value)} · N={m.sampleSize}</small></div>)}</div>
 <details className="stp-detail"><summary>All advanced metrics and last-ten form</summary><div className="stp-table-scroll"><table><thead><tr><th>Metric</th><th>Team</th><th>Opponent</th><th>Samples</th><th>Last 10</th></tr></thead><tbody>{profile.advanced.metrics.map(m=><tr key={m.key}><td>{m.label}</td><td>{fmt(m.value)}</td><td>{fmt(m.opponent.value)}</td><td>{m.sampleSize}</td><td>{fmt(m.recent10.value)} ({m.recent10.sampleSize})</td></tr>)}</tbody></table></div></details></section>}
 {panel==='rankings'&&<section className="stp-panel"><h3>Competition source rankings</h3><p className="stp-muted">{leagueRankings?.methodology||'Rankings loading or unavailable.'}</p>
 {rankError&&<p role="status">Ranking source unavailable: {rankError}</p>}{selectedRanking?.missingReason&&<p>{selectedRanking.missingReason.replaceAll('-',' ')}</p>}
 {selectedRanking&&!selectedRanking.missingReason&&<><div className="stp-metric-grid">{(leagueRankings?.metrics||[]).filter(m=>selectedRanking.ranks?.[m.key]).slice(0,8).map(m=>{const r=selectedRanking.ranks[m.key];return <div key={m.key} className="stp-metric-card"><span>{m.label}</span><strong>#{r.rank}<small> / {r.eligibleTeams}</small></strong><small>{fmt(r.value)} · N={r.sample??'—'}</small></div>;})}</div>
 <details className="stp-detail"><summary>All competition rankings</summary><div className="stp-table-scroll"><table><thead><tr><th>Metric</th><th>Rank</th><th>Value</th><th>Sample</th></tr></thead><tbody>{(leagueRankings?.metrics||[]).map(m=>{const r=selectedRanking.ranks?.[m.key];return <tr key={m.key}><td>{m.label}</td><td>{r?'#'+r.rank+' / '+r.eligibleTeams:'Unavailable'}</td><td>{r?fmt(r.value):'—'}</td><td>{r?.sample??'—'}</td></tr>})}</tbody></table></div></details></>}</section>}
 {panel==='players'&&<section className="stp-panel"><h3>Squad and player intelligence</h3><p className="stp-muted">{profile.roster.source||'Roster unavailable'} · {profile.roster.players.length} roster members {profile.roster.stale?'· Stale snapshot':''}</p>
 {profile.roster.unavailableReason&&<p>{profile.roster.unavailableReason}</p>}
 <div className="stp-table-scroll"><table><thead><tr><th>Player</th><th>Position</th><th>Number</th><th>Age</th></tr></thead><tbody>{profile.roster.players.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.position||'—'}</td><td>{p.jersey||'—'}</td><td>{p.age??'—'}</td></tr>)}</tbody></table></div>
 <h3>PitchAPI player-match contributions</h3><p className="stp-muted">{profile.playerContributors?.scope||'No verified player-match observations available.'}</p><p className="stp-muted">{profile.playerContributors?.providerIdPolicy}</p>
 <div className="stp-table-scroll"><table><thead><tr><th>Player</th><th>Matches</th><th>Minutes</th><th>Goals</th><th>Assists</th><th>xT</th><th>VAEP</th><th>xAG</th><th>Prog. passes</th></tr></thead><tbody>{(profile.playerContributors?.players||[]).map(p=><tr key={p.id}><td>{p.name||'Unknown'}</td><td>{p.acquiredMatches??'—'}</td><td>{p.minutes??'—'}</td><td>{p.goals??'—'}</td><td>{p.assists??'—'}</td><td>{fmt(p.expectedThreat)}</td><td>{fmt(p.vaep)}</td><td>{fmt(p.expectedAssistedGoals)}</td><td>{p.progressivePasses??'—'}</td></tr>)}</tbody></table></div></section>}
 {panel==='data'&&<section className="stp-panel"><h3>Research provenance and audit</h3><p>Profile as of {profile.stats.asOf}. Acquired match window {profile.advanced.historyStart||'—'} to {profile.advanced.historyEnd||'—'}.</p><p>{profile.advanced.reconciliation.storedBigChancesMismatchCount} retained big-chance reconciliation differences.</p>
 <p>{profile.playerContributors?.providerIdPolicy||'Provider player IDs are not interchangeable.'}</p><p className="stp-muted">Source rankings, rosters, and advanced observations do not independently authorize betting.</p></section>}
 </article>}
 </>}</section>;
}
