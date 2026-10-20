import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../../components/TeamLogo.jsx";
import "./proTeamDirectory.css";

const initial = (name = "") => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "FB";
const validImage = url => typeof url === "string" && /^https:\/\//.test(url);
const readableDate = value => {
  const date = new Date(value || 0);
  return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
};

function PlayerPortrait({ player }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [player.headshotUrl]);
  return <div className="ptd-portrait">
    {validImage(player.headshotUrl) && !broken ? <img src={player.headshotUrl} alt={player.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <span aria-label="No official photo available">{initial(player.name)}</span>}
  </div>;
}

export default function ProTeamDirectory({ sport, refreshKey = 0 }) {
  const [teams, setTeams] = useState([]);
  const [selected, setSelected] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [position, setPosition] = useState("all");
  const [display, setDisplay] = useState("cards");
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [rosterError, setRosterError] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    setTeams([]); setSelected(""); setRoster(null); setTeamSearch(""); setPlayerSearch("");
    setDirectoryError("");
    fetch("/api/pro-team-directory?sport=" + encodeURIComponent(sport), { signal: ac.signal })
      .then(async r => { const body = await r.json(); if (!r.ok || !body.ok) throw Error(body.error || "Directory unavailable"); return body; })
      .then(body => { if (!ac.signal.aborted) setTeams(body.teams || []); })
      .catch(e => { if (!ac.signal.aborted) setDirectoryError(e.message); });
    return () => ac.abort();
  }, [sport, refreshKey]);

  useEffect(() => {
    if (!selected) return;
    const ac = new AbortController();
    setRoster(null); setRosterError(""); setLoading(true); setPlayerSearch(""); setPosition("all");
    fetch("/api/pro-team-directory?sport=" + encodeURIComponent(sport) + "&team=" + encodeURIComponent(selected), { signal: ac.signal })
      .then(async r => { const body = await r.json(); if (!r.ok || !body.ok) throw Error(body.error || "Roster unavailable"); return body; })
      .then(body => { if (!ac.signal.aborted) setRoster(body); })
      .catch(e => { if (!ac.signal.aborted) setRosterError(e.message); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [sport, selected, refreshKey]);

  const filteredTeams = useMemo(() => teams.filter(t => (t.name + " " + t.abbr).toLowerCase().includes(teamSearch.toLowerCase())), [teams, teamSearch]);
  const filteredPlayers = useMemo(() => (roster?.players || []).filter(p =>
    (position === "all" || p.position === position) &&
    (p.name + " " + p.jersey + " " + p.position).toLowerCase().includes(playerSearch.toLowerCase())
  ).sort((a,b) => a.name.localeCompare(b.name)), [roster, playerSearch, position]);
  const positions = useMemo(() => [...new Set((roster?.players || []).map(p => p.position).filter(Boolean))].sort(), [roster]);
  const currentTeam = teams.find(t => t.abbr === selected) || roster?.team;
  const propsUrl = "/?route=player-props&sportFilter=" + encodeURIComponent(sport);
  return <div className="ptd-root">
    <div className="ptd-section-heading"><div><h3>{sport.toUpperCase()} team directory</h3><p>{teams.length} verified registry entries · Official roster retrieval on team selection</p></div>
      <a className="ptd-props-link" href={propsUrl}>Open {sport.toUpperCase()} player props ↗</a></div>
    <div className="ptd-team-picker">
      <label className="stp-control">Find team <input type="search" value={teamSearch} onChange={e => setTeamSearch(e.target.value)} placeholder="Team name or abbreviation"/></label>
      <span className="stp-muted">{filteredTeams.length} teams</span>
    </div>
    {directoryError ? <p role="alert" className="stp-alert">Team directory: {directoryError}</p> : null}
    {!directoryError && !teams.length ? <p role="status">Loading {sport.toUpperCase()} teams…</p> : null}
    <div className="ptd-teams" aria-label={sport.toUpperCase() + " teams"}>
      {filteredTeams.map(t => <button type="button" key={t.id} className={"ptd-team-button " + (selected === t.abbr ? "is-active" : "")}
        onClick={() => setSelected(t.abbr)} aria-pressed={selected === t.abbr} style={{ "--ptd-team-color": t.color || "#2b6e9c" }}>
        <TeamLogo team={t} size={52} /><span><strong>{t.name}</strong><small>{t.abbr}</small></span>
      </button>)}
    </div>
    {selected ? <section className="ptd-roster-section" style={{ "--ptd-team-color": currentTeam?.color || "#2b6e9c", "--ptd-accent": currentTeam?.altColor || "#8fd6ff" }}>
      <header className="ptd-team-hero"><TeamLogo team={currentTeam || {sport, abbr:selected}} size={94} />
        <div><span className="stp-eyebrow">{sport.toUpperCase()} · TEAM & PLAYER INTELLIGENCE</span><h2>{currentTeam?.name || selected}</h2>
          <p>{roster ? roster.rosterCount + " players • " + roster.source.replaceAll("_", " ") : "Roster directory"}</p></div>
        <a className="ptd-props-link" href={propsUrl}>Player props ↗</a>
      </header>
      {loading ? <p role="status">Loading current roster and headshots…</p> : null}
      {rosterError ? <p role="alert" className="stp-alert">Roster unavailable: {rosterError}. No prior roster is being presented as current.</p> : null}
      {roster ? <>
        <div className="ptd-roster-info"><span><b>{roster.rosterCount}</b> roster members</span><span><b>{roster.players.filter(p => p.headshotSource && p.headshotUrl).length}</b> photo URLs supplied</span><span>Retrieved {readableDate(roster.fetchedAt)}</span><span>Source: <a href={roster.sourceUrl} target="_blank" rel="noreferrer">{roster.source.replaceAll("_", " ")}</a></span></div>
        <div className="ptd-player-toolbar">
          <label className="stp-control">Find player <input type="search" value={playerSearch} onChange={e => setPlayerSearch(e.target.value)} placeholder="Search roster…" /></label>
          <label className="stp-control">Position <span className="stp-select"><select value={position} onChange={e => setPosition(e.target.value)}>
            <option value="all">All positions</option>{positions.map(p => <option key={p} value={p}>{p}</option>)}</select></span></label>
          <div className="ptd-view-toggle" role="group" aria-label="Roster display"><button className={display === "cards" ? "active" : ""} onClick={() => setDisplay("cards")}>Headshots</button><button className={display === "table" ? "active" : ""} onClick={() => setDisplay("table")}>Table</button></div>
          <span className="stp-muted">{filteredPlayers.length} shown</span>
        </div>
        {display === "cards" ? <div className="ptd-player-grid">{filteredPlayers.map(p => <article className="ptd-player-card" key={p.playerKey}>
          <PlayerPortrait player={p} />
          <div className="ptd-player-card-info"><strong>{p.name}</strong><span>{p.position || "—"} {p.jersey ? " · #" + p.jersey : ""}</span>
            <a href={propsUrl + "&propPlayer=" + encodeURIComponent(p.name)}>View player props ↗</a></div>
        </article>)}</div> : <div className="stp-table-scroll"><table className="ptd-player-table"><thead><tr><th>Photo</th><th>Player</th><th>Position</th><th>Number</th><th>Roster status</th><th>Player props</th></tr></thead>
          <tbody>{filteredPlayers.map(p => <tr key={p.playerKey}><td><PlayerPortrait player={p}/></td><td><strong>{p.name}</strong><small>{p.playerKey}</small></td><td>{p.position || "—"}</td><td>{p.jersey || "—"}</td><td>{p.status || "Not supplied"}</td><td><a href={propsUrl + "&propPlayer=" + encodeURIComponent(p.name)}>View props ↗</a></td></tr>)}</tbody></table></div>}
        {!filteredPlayers.length ? <p className="stp-muted">No players match these filters.</p> : null}
        <p className="ptd-provenance">Source player IDs remain namespaced to ESPN or the NHL. Headshot coverage counts source URLs, not confirmed successful image downloads. A roster entry is not evidence of game availability or prop-market qualification.</p>
      </> : null}
    </section> : <p className="ptd-hint">Select a team to open its roster, headshots, and player-prop links.</p>}
  </div>;
}
