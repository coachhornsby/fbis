import { useEffect, useMemo, useState } from "react";
import "./cfbTeams.css";
import CfbCurrentSummary from './CfbCurrentSummary.jsx';
import CfbResearchPanels from './CfbResearchPanels.jsx';
import {cfbConferenceLogo} from './conferenceLogos.js';

function initialTeam() {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("team");
}
function readJson(res) {
  return res.json().then(data => {
    if (!res.ok || data.ok !== true) throw new Error(data.error || "Team profile unavailable");
    return data;
  });
}
const show = v => v == null || v === "" ? "—" : String(v);
function stamp(v) {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short" })
    : "—";
}
function TeamMark({team, hero = false}) {
  const cls = hero ? "ft-logo ft-logo-hero" : "ft-logo";
  return team.logo.url
    ? <img className={cls} src={team.logo.url} loading="lazy" alt={team.displayName + " logo (ESPN source)"}/>
    : <span className={cls}>{team.abbreviation || "?"}</span>;
}
function Fact({label,value}) {
  return <div className="ft-fact"><dt>{label}</dt><dd>{show(value)}</dd></div>;
}
function MetricGroups({groups}) {
  const populated=Object.entries(groups||{}).filter(([,m])=>m&&Object.keys(m).length);
  if(!populated.length)return <div className="ft-missing">No source-observed statistical metrics yet</div>;
  return <div className="ft-metric-sections">{populated.map(([family,metrics])=>
    <section className="ft-metric-section" key={family}>
      <h4>{family.replaceAll("_"," ").toUpperCase()}</h4>
      <div className="ft-metric-grid">{Object.entries(metrics).map(([name,value])=>
        <div className="ft-metric" key={name}><span>{name.replaceAll("_"," ")}</span>
          <strong>{value == null?"—":Number(value).toLocaleString("en-US",{maximumFractionDigits:3})}</strong>
        </div>)}</div>
    </section>)}</div>;
}
function TeamProfile({detail,onBack,onSeasonChange,onPlayerChange,intelligence,intelligenceError}) {
  const {team,featureState,legacyForm,evidence={},apRanking,researchPanels} = detail, s=team.stadium;
  const [activeTab,setActiveTab]=useState("overview");
  const [positionFilter,setPositionFilter]=useState("ALL");
  const [playerSearch,setPlayerSearch]=useState("");
  const roster=evidence?.roster?.players||[];
  const selectedId=evidence?.selectedPlayer||null;
  const selected=roster.find(r=>r.playerId===selectedId)||null;
  const playerStats=selectedId?evidence?.playerStatistics?.byPlayer?.[selectedId]:null;
  const positionOptions=["ALL",...new Set(roster.map(r=>r.position).filter(Boolean))].sort();
  const visibleRoster=roster.filter(r=>(positionFilter==="ALL"||r.position===positionFilter)&&
    (!playerSearch.trim()||[r.name,r.position,r.jersey].filter(Boolean).some(v=>String(v).toLowerCase().includes(playerSearch.toLowerCase()))));
  const hasSnapshot = featureState?.state === "RESEARCH_SNAPSHOT";
  const features = featureState?.features || {};
  return <div className="ft-profile" data-active-tab={activeTab}>
    <button type="button" className="ft-back" onClick={onBack}>← All FBS teams</button>
    <header className="ft-hero" style={{"--ft-primary":team.colors.primary || "#27384d","--ft-secondary":team.colors.secondary || team.colors.primary || "#4f83bd"}}>
      <TeamMark team={team} hero/>
      <div className="ft-hero-info">
        <div className="ft-kicker">{show(team.conference)} · FBS</div>
        <h2>{team.displayName}</h2>
        <p>{team.school} · {show(team.abbreviation)} · RESEARCH PROFILE</p>
        <p><strong>AP Top 25: {apRanking?.state==="AVAILABLE"?(apRanking.rank?"#"+apRanking.rank:"Unranked"):"Unavailable"}</strong> · {apRanking?.week?"Week "+apRanking.week:"Poll week unavailable"} · {apRanking?.asOf||"Date unavailable"}</p>
        <div className="ft-color-row">
          <span className="ft-swatch" style={{background:team.colors.primary || "transparent"}}/>
          <span className="ft-swatch" style={{background:team.colors.secondary || "transparent"}}/>
          <span>Primary {show(team.colors.primary)} · Secondary {show(team.colors.secondary)}</span>
        </div>
      </div>
    </header>
    <div className="ft-rank-strip" aria-label="National ranking systems">
      <div><span>AP TOP 25</span><strong>{apRanking?.state==="AVAILABLE"?(apRanking.rank?"#"+apRanking.rank:"Unranked"):"Unavailable"}</strong><small>{apRanking?.week?"Week "+apRanking.week:"Source not confirmed"}</small></div>
      <div><span>CFP PLAYOFF RANK</span><strong>Not yet published</strong><small>2026 committee rankings; no fabricated rank</small></div>
      <div><span>FBIS POWER RANK</span><strong>Unavailable</strong><small>Awaiting verified, model-derived national rank</small></div>
    </div>
    <nav className="ft-tabs" aria-label="Team profile sections">{[
      ["overview","Overview"],["offense","Offense & Stats"],["defense","Defense & Games"],
      ["players","Players"],["schedule","Schedule"],["data","Data Lab"]
    ].map(([key,label])=><button type="button" key={key} className={activeTab===key?"is-active":""}
      onClick={()=>setActiveTab(key)} aria-current={activeTab===key?"page":undefined}>{label}</button>)}</nav>
    {activeTab==="overview"?<CfbCurrentSummary intelligence={intelligence} error={intelligenceError} teamId={team.teamId} season={evidence.season||2026}/>:null}
    {activeTab==="overview"?<CfbResearchPanels researchPanels={researchPanels}/>:null}
    <section className="ft-panel ft-tab-panel" data-section="data">
      <div className="ft-heading"><h3>Identity & team colors</h3><small>ESPN/SDV-sourced · school verification pending</small></div>
      <dl className="ft-facts">
        <Fact label="School" value={team.school}/>
        <Fact label="Mascot / team nickname" value={team.mascot.teamNickname}/>
        <Fact label="Costumed mascot character" value={team.mascot.costumedCharacter || "Not independently sourced"}/>
        <Fact label="Conference" value={team.conference}/>
        <Fact label="Logo" value={team.logo.url ? "ESPN CDN logo" : "Not available"}/>
        <Fact label="Primary color" value={team.colors.primary}/>
        <Fact label="Secondary color" value={team.colors.secondary}/>
        <Fact label="Official school verification" value="Pending"/>
        <Fact label="Canonical ID" value={team.teamId}/>
        <Fact label="Source observed" value={stamp(team.provenance.observedAt)}/>
      </dl>
    </section>
    <section className="ft-panel ft-tab-panel" data-section="data">
      <div className="ft-heading"><h3>Home stadium & geographic coordinates</h3>
        <small>Provider location · independently unverified</small></div>
      <div className="ft-venue-top"><div><h4>{show(s.name)}</h4>
        <p>{[s.city,s.state].filter(Boolean).join(", ") || "Location unavailable"}</p></div>
        {s.mapUrl ? <a href={s.mapUrl} target="_blank" rel="noopener noreferrer" className="ft-map">
          Open coordinates in Maps ↗</a> : null}</div>
      <dl className="ft-facts">
        <Fact label="Latitude" value={s.latitude}/>
        <Fact label="Longitude" value={s.longitude}/>
        <Fact label="Venue ID" value={s.venueId}/>
        <Fact label="Stadium capacity" value={s.capacity?.toLocaleString("en-US")}/>
        <Fact label="Elevation" value={s.elevationMeters == null ? null : String(s.elevationMeters) + " m"}/>
        <Fact label="Indoor / dome" value={s.indoor == null ? null : s.indoor ? "Yes" : "No"}/>
        <Fact label="Playing surface" value={s.grass == null ? null : s.grass ? "Grass" : "Non-grass (verify type)"}/>
        <Fact label="Time zone" value={s.timezone}/>
      </dl>
      <p className="ft-note">Coordinates are the stored provider venue location, not a verified street address or surveyed field-center.
        Stadium naming and precise pin placement remain subject to school/venue verification.</p>
    </section>
    <section className="ft-panel ft-tab-panel" data-section="data">
      <div className="ft-heading"><h3>Persistent team statistics</h3>
        <small>{hasSnapshot ? "Saved research snapshot" : "Not populated"}</small></div>
      {hasSnapshot ? <>
        <p className="ft-muted">Version {show(featureState.featureVersion)} · As of {stamp(featureState.asOf)}
          {" · "}Not authorized to affect the fitted model.</p>
        <div className="ft-state-grid">{["offense","defense","passing","rushing","pace","situational","ratings","roster"].map(group =>
          <div key={group} className="ft-state-tile">
            <strong>{group.toUpperCase()}</strong><span>{features[group] == null
              ? "No stored values" : typeof features[group] === "object" ? "Stored" : show(features[group])}</span>
          </div>)}</div>
        <details className="ft-raw"><summary>Inspect saved feature record and missingness</summary>
          <pre>{JSON.stringify({features,missingness:featureState.missingness},null,2)}</pre>
        </details>
      </> : <div className="ft-empty"><strong>Persistent statistical timeline unavailable.</strong>
        <p>Team identity is saved, but the incremental offense, defense, pace and opponent-adjusted
          snapshots are not yet populated. Historical pregame data will not be reconstructed from future observations.</p>
        <small>State: {show(featureState?.state)} · Dependency: college persistence recovery and PIT ingestion</small>
      </div>}
      {legacyForm ? <div className="ft-legacy">
        <strong>Older team-form evidence — not the active fitted model state</strong>
        <p>{show(legacyForm.games)} games · {show(legacyForm.pointsFor)} points scored
          {" · "}{show(legacyForm.pointsAgainst)} allowed</p>
        <small>Stored {stamp(legacyForm.updatedAt)} · May be stale</small>
      </div> : null}
    </section>
    <section className="ft-panel ft-tab-panel" data-section="offense">
      <div className="ft-heading"><h3>Season team statistics · All available fields</h3>
        <small>{evidence?.teamStatistics?.state === "SOURCE_OBSERVED" ? "Source observed" : "Not populated"}</small></div>
      <div className="ft-stats-summary">Selected season
        <select aria-label="Season" value={evidence.season||2026} onChange={e=>onSeasonChange(Number(e.target.value))}>
          {(evidence.availableSeasons||[2026]).map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <span>{evidence?.teamStatistics?.metricsCount||0} verified stored season metrics</span>
      </div>
      <MetricGroups groups={evidence.teamStatistics?.groups} />
      {evidence.teamStatistics?.state !== "SOURCE_OBSERVED" ? <p className="ft-note">
        No qualified team offensive, defensive, passing, rushing, situational, tempo, line-play,
        havoc or special-teams statistical ledger has been persisted for this season. The roster is not a substitute.
      </p> : <p className="ft-note">Source: {show(evidence.teamStatistics.source)} · Source as-of {stamp(evidence.teamStatistics.sourceAsOf)}
      {" · "}Collected {stamp(evidence.teamStatistics.asOf)} · Read-only, not an active model input.</p>}
    </section>
    <section className="ft-panel ft-tab-panel" data-section="defense">
      <div className="ft-heading"><h3>Individual game team statistics</h3>
        <small>{evidence?.teamGameStatistics?.count||0} source-observed team-game records</small></div>
      {(evidence?.teamGameStatistics?.games||[]).length
        ? <div className="ft-game-stats">{evidence.teamGameStatistics.games.map(g=>
          <details className="ft-game-entry" key={g.gameId}>
            <summary>{show(g.gameAt)} · {show(g.opponent)} · {g.stats.metricsCount} metrics</summary>
            <p className="ft-note">Source: {show(g.stats.source)} · Observed {stamp(g.stats.asOf)}</p>
            <MetricGroups groups={g.stats.groups}/>
          </details>)}</div>
        : <div className="ft-missing">No source-observed individual team-game efficiency and box-score records
          are stored for this season. The historical SDV team-game archive is a staging candidate,
          not live production state.</div>}
    </section>
    <section className="ft-panel ft-tab-panel" data-section="players">
      <div className="ft-heading"><h3>2026 and historical team rosters · All positions</h3>
        <small>{roster.length} distinct players · {show(evidence?.roster?.state)}</small></div>
      <p className="ft-note">Every listed player is a dated SportsDataverse/ESPN roster membership, not a confirmed starter,
        appearance or statistical performance. Membership does not authorize game or prop projections.</p>
      <div className="ft-filters ft-roster-filters">
        <label>Find a player<input type="search" value={playerSearch} onChange={e=>setPlayerSearch(e.target.value)}
          placeholder="Player, jersey or position…"/></label>
        <label>Position<select value={positionFilter} onChange={e=>setPositionFilter(e.target.value)}>
          {positionOptions.map(p=><option key={p} value={p}>{p==="ALL"?"All positions":p}</option>)}
        </select></label>
      </div>
      <div className="ft-results">{visibleRoster.length} matching players · {evidence?.playerStatistics?.availableCount||0} verified player season statistical records</div>
      <div className="ft-table-scroll"><table className="ft-table"><thead><tr>
        <th>Jersey</th><th>Player</th><th>Position</th><th>Class</th><th>Height</th><th>Weight</th><th>Performance</th>
      </tr></thead><tbody>{visibleRoster.map(r=><tr key={r.playerId} className={selectedId===r.playerId?"ft-selected":""}>
        <td>{show(r.jersey)}</td><td><button type="button" className="ft-player-link" onClick={()=>onPlayerChange(selectedId===r.playerId?null:r.playerId)}>{r.name}</button></td>
        <td>{show(r.position)}</td><td>{show(r.classYear)}</td>
        <td>{r.heightInches == null?"—":r.heightInches+" in"}</td><td>{r.weightPounds == null?"—":r.weightPounds+" lb"}</td>
        <td>{evidence.playerStatistics?.byPlayer?.[r.playerId]?.state==="SOURCE_OBSERVED"?"Verified stats":"—"}</td>
      </tr>)}</tbody></table></div>
      {selected ? <div className="ft-player-detail">
        <div className="ft-heading"><h4>{selected.name} · {show(selected.position)} · #{show(selected.jersey)}</h4>
          <button type="button" onClick={()=>onPlayerChange(null)}>Close</button></div>
        <p className="ft-muted">{show(selected.classYear)} · {selected.heightInches==null?"—":selected.heightInches+" in"}
        {" · "}{selected.weightPounds==null?"—":selected.weightPounds+" lb"}
        {" · "}Roster observed {stamp(selected.observedAt)}</p>
        <h4>Individual season statistics</h4>
        <MetricGroups groups={playerStats?.groups}/>
        {!playerStats?.groups ? <p className="ft-note">Verified passing, rushing, receiving, defense,
          kicking, punting, return and advanced totals are not yet stored for this player.</p> : null}
        <h4>Individual game statistics</h4>
        {(evidence.playerGameStatistics?.rows||[]).length ? (evidence.playerGameStatistics.rows.map(g=><div className="ft-player-game" key={g.gameId}>
          <strong>{show(g.gameAt)} · {show(g.opponent)}</strong><MetricGroups groups={g.groups}/></div>))
          : <p className="ft-note">No individually verified game box-score/statistical observations stored.</p>}
      </div> : null}
    </section>
    <section className="ft-panel ft-tab-panel" data-section="schedule">
      <div className="ft-heading"><h3>Season games and opponents</h3>
        <small>{evidence?.schedule?.count||0} ESPN team events · {show(evidence?.schedule?.state)}</small></div>
      <p className="ft-note">Team-specific ESPN fixtures. W/L and final scores appear only when the event status is officially final. AP ranking is separate from FBIS ratings.</p>
      {evidence?.schedule?.state!=="AVAILABLE" ? <p role="status">Current schedule source unavailable; stored fixtures are not shown as verified.</p> : null}
      <div className="ft-table-scroll"><table className="ft-table"><thead><tr><th>Date</th><th>Site</th><th>Opponent</th><th>Status</th><th>Score</th><th>W/L</th></tr></thead>
        <tbody>{(evidence?.schedule?.games||[]).map(g=><tr key={g.id}>
          <td>{show(g.date)}</td><td>{show(g.location)}</td><td>{show(g.opponent)}</td>
          <td>{g.completed?"Final":show(g.status)}</td>
          <td>{g.verifiedResult?g.pointsFor+"–"+g.pointsAgainst:"—"}</td>
          <td>{g.result||"—"}</td>
        </tr>)}</tbody></table></div>
    </section>
    <section className="ft-panel ft-tab-panel" data-section="data">
      <h3>Planned weekly update lifecycle</h3>
      <p className="ft-muted">Completed-game source record → append team observations → new immutable team
        snapshot → frozen matchup inputs. This read-only profile does not rebuild weekly history,
        alter model coefficients, or authorize wagers.</p>
    </section>
  </div>;
}
export default function CfbTeamsView({refreshKey=0}) {
  const [intelligence,setIntelligence]=useState(null),[intelligenceError,setIntelligenceError]=useState('');
  const [directory,setDirectory]=useState(null);
  const [id,setId]=useState(initialTeam);
  const [detail,setDetail]=useState(null);
  const [season,setSeason]=useState(2026);
  const [playerId,setPlayerId]=useState(null);
  const [term,setTerm]=useState("");
  const [conference,setConference]=useState("ALL");
  const [failedConferenceLogo,setFailedConferenceLogo]=useState(null);
  useEffect(()=>setFailedConferenceLogo(null),[conference]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  useEffect(()=>{
    const ac=new AbortController();
    fetch('/api/cfb-intelligence',{signal:ac.signal}).then(readJson).then(d=>{setIntelligence(d);setIntelligenceError('');})
      .catch(e=>{if(!ac.signal.aborted)setIntelligenceError('Source summary unavailable: '+e.message);});
    return()=>ac.abort();
  },[refreshKey]);
  useEffect(()=>{
    const ac=new AbortController();
    setLoading(true);
    fetch("/api/cfb-teams",{signal:ac.signal}).then(readJson).then(setDirectory)
      .catch(e=>{if(!ac.signal.aborted)setError(e.message);})
      .finally(()=>{if(!ac.signal.aborted)setLoading(false);});
    return ()=>ac.abort();
  },[refreshKey]);
  useEffect(()=>{
    if(!id){setDetail(null);return undefined;}
    const ac=new AbortController();
    setDetail(null);
    fetch("/api/cfb-teams?team="+encodeURIComponent(id)+"&season="+season+
      (playerId?"&player="+encodeURIComponent(playerId):""),{signal:ac.signal}).then(readJson)
      .then(setDetail).catch(e=>{if(!ac.signal.aborted)setError(e.message);});
    return ()=>ac.abort();
  },[id,refreshKey,season,playerId]);
  const teams=directory?.teams||[];
  const conferences=useMemo(()=>["ALL",...new Set(teams.map(t=>t.conference).filter(Boolean))]
    .sort((a,b)=>a==="ALL"?-1:b==="ALL"?1:a.localeCompare(b)),[teams]);
  const visible=useMemo(()=>teams.filter(t=>{
    const matches=conference==="ALL"||conference===t.conference;
    return matches && (!term.trim()||[t.school,t.displayName,t.abbreviation,t.athleticName,t.stadium.name]
      .filter(Boolean).some(v=>v.toLowerCase().includes(term.trim().toLowerCase())));
  }),[teams,term,conference]);
  function select(next) {
    setId(next);
    setPlayerId(null);
    setSeason(2026);
    if(typeof window!=="undefined"){
      const url=new URL(window.location.href);
      if(next)url.searchParams.set("team",next); else url.searchParams.delete("team");
      window.history.replaceState({},"",url);
    }
  }
  return <section className="ft-page">
    <div className="ft-top"><div><div className="ft-kicker">COLLEGE FOOTBALL · FBS ONLY</div>
      <h1>Team Profiles</h1><p>Persistent identity, branding, stadium and statistical-state records.</p>
      </div><strong>{directory ? directory.count+" FBS teams" : "FBS directory"}</strong></div>
    {error && <div className="ft-error" role="alert">{error}</div>}
    {id ? (detail ? <TeamProfile detail={detail} intelligence={intelligence} intelligenceError={intelligenceError} onBack={()=>select(null)} onSeasonChange={n=>{setSeason(n);setPlayerId(null);}} onPlayerChange={setPlayerId}/>
      : <div className="ft-panel"><button type="button" onClick={()=>select(null)}>← All FBS teams</button>
        <p>Loading profile or data unavailable…</p></div>)
      : <>
        <div className="ft-filters">
          <label>Search teams<input type="search" value={term} onChange={e=>setTerm(e.target.value)}
            placeholder="School, nickname, stadium…"/></label>
          <label>Conference<span className="ft-conference-picker">{conference!=="ALL"&&failedConferenceLogo!==conference&&cfbConferenceLogo(conference)&&<img alt="" src={cfbConferenceLogo(conference)} onError={()=>setFailedConferenceLogo(conference)}/>}<select value={conference} onChange={e=>setConference(e.target.value)}>
            {conferences.map(c=><option key={c} value={c}>{c==="ALL"?"All FBS conferences":c}</option>)}
          </select></span></label>
        </div>
        <p className="ft-muted">{visible.length} matching teams · provider-sourced profile facts</p>
        {loading && !directory && <div className="ft-panel">Loading persistent FBS directory…</div>}
        <div className="ft-grid">{visible.map(t=><button type="button" className="ft-team-tile"
          key={t.teamId} onClick={()=>select(t.teamId)}>
          <div className="ft-tile-stripe" style={{background:t.colors.primary||"#263b52"}}/>
          <TeamMark team={t}/>
          <strong>{t.displayName}</strong>
          <span>{show(t.conference)}</span><small>{show(t.stadium.name)} · {show(t.stadium.state)}</small>
          <b>View team →</b>
        </button>)}</div>
      </>}
    <p className="ft-footer">Read-only saved D1 identity/roster data and separately cached public SDV summaries.
      School-official validation pending · No CFBD acquisition · No projection authority.</p>
  </section>;
}
