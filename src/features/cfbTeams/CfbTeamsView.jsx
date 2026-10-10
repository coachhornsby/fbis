import { useEffect, useMemo, useState } from "react";
import "./cfbTeams.css";

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
function TeamProfile({detail,onBack}) {
  const {team,featureState,legacyForm} = detail, s=team.stadium;
  const hasSnapshot = featureState?.state === "RESEARCH_SNAPSHOT";
  const features = featureState?.features || {};
  return <div className="ft-profile">
    <button type="button" className="ft-back" onClick={onBack}>← All FBS teams</button>
    <header className="ft-hero" style={{"--ft-primary":team.colors.primary || "#27384d"}}>
      <TeamMark team={team} hero/>
      <div className="ft-hero-info">
        <div className="ft-kicker">{show(team.conference)} · FBS</div>
        <h2>{team.displayName}</h2>
        <p>{team.school} · {show(team.abbreviation)} · RESEARCH PROFILE</p>
        <div className="ft-color-row">
          <span className="ft-swatch" style={{background:team.colors.primary || "transparent"}}/>
          <span className="ft-swatch" style={{background:team.colors.secondary || "transparent"}}/>
          <span>Primary {show(team.colors.primary)} · Secondary {show(team.colors.secondary)}</span>
        </div>
      </div>
    </header>
    <section className="ft-panel">
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
    <section className="ft-panel">
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
    <section className="ft-panel">
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
    <section className="ft-panel">
      <h3>Planned weekly update lifecycle</h3>
      <p className="ft-muted">Completed-game source record → append team observations → new immutable team
        snapshot → frozen matchup inputs. This read-only profile does not rebuild weekly history,
        alter model coefficients, or authorize wagers.</p>
    </section>
  </div>;
}
export default function CfbTeamsView({refreshKey=0}) {
  const [directory,setDirectory]=useState(null);
  const [id,setId]=useState(initialTeam);
  const [detail,setDetail]=useState(null);
  const [term,setTerm]=useState("");
  const [conference,setConference]=useState("ALL");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
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
    fetch("/api/cfb-teams?team="+encodeURIComponent(id),{signal:ac.signal}).then(readJson)
      .then(setDetail).catch(e=>{if(!ac.signal.aborted)setError(e.message);});
    return ()=>ac.abort();
  },[id,refreshKey]);
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
    {id ? (detail ? <TeamProfile detail={detail} onBack={()=>select(null)}/>
      : <div className="ft-panel"><button type="button" onClick={()=>select(null)}>← All FBS teams</button>
        <p>Loading profile or data unavailable…</p></div>)
      : <>
        <div className="ft-filters">
          <label>Search teams<input type="search" value={term} onChange={e=>setTerm(e.target.value)}
            placeholder="School, nickname, stadium…"/></label>
          <label>Conference<select value={conference} onChange={e=>setConference(e.target.value)}>
            {conferences.map(c=><option key={c} value={c}>{c==="ALL"?"All FBS conferences":c}</option>)}
          </select></label>
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
    <p className="ft-footer">Read-only saved D1 data · SportsDataverse / ESPN + CFBD context.
      School-official validation pending · No provider acquisition · No projection authority.</p>
  </section>;
}